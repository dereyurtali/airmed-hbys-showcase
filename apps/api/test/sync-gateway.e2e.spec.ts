import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import type { App } from 'supertest/types';
import { io as ioClient, Socket } from 'socket.io-client';
import { signSyncBody } from '../src/sync/sync-hmac';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// A12 PR 4 — WebSocket gateway integration.
// app.listen(0) → ephemeral port; client connects with tenant JWT;
// sync POST (PR 2) tetiklendiğinde sync.applied event broadcast'i alır.

const SECRET = 'ws-test-secret-32-chars-long-hello!!';

interface LoginBody {
  accessToken: string;
}

async function loginTenant(
  app: INestApplication,
  slug: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer() as App)
    .post('/api/auth/login')
    .send({ tenantSlug: slug, email, password });
  return (res.body as LoginBody).accessToken;
}

async function postSync(port: number, body: unknown) {
  const bodyStr = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = signSyncBody(SECRET, bodyStr, ts);
  return fetch(`http://127.0.0.1:${port}/api/internal/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Signature': sig,
      'X-Sync-Timestamp': ts,
    },
    body: bodyStr,
  });
}

function waitForEvent<T>(client: Socket, name: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Timeout waiting for ${name} (${timeoutMs}ms)`)),
      timeoutMs,
    );
    client.once(name, (data: T) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

describe('A12 sync WebSocket gateway (auth + tenant room + broadcast)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let port: number;

  beforeAll(async () => {
    process.env.SYNC_HMAC_SECRET = SECRET;
    process.env.SYNC_NODE_SOURCE = 'LOCAL';
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    // Gerçek HTTP server'ı boot et — socket.io engine bunu kullanır
    await app.listen(0);
    const url = await app.getUrl();
    port = Number(new URL(url).port);
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  });

  beforeEach(async () => {
    await prisma.patient.deleteMany({
      where: { tenantId: fixtures.tenantA.id, id: { not: fixtures.tenantA.patientId } },
    });
    await prisma.syncOutbox.deleteMany({});
    await prisma.syncConflict.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('missing token → disconnect (auth fail)', async () => {
    const client = ioClient(`http://127.0.0.1:${port}/sync`, {
      transports: ['websocket'],
      reconnection: false,
    });
    try {
      const disconnected = new Promise<void>((resolve) => client.on('disconnect', () => resolve()));
      await disconnected;
      expect(client.connected).toBe(false);
    } finally {
      client.disconnect();
    }
  });

  it('valid tenant JWT → connect + receive sync.applied on remote INSERT', async () => {
    const accessToken = await loginTenant(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const client = ioClient(`http://127.0.0.1:${port}/sync`, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: accessToken },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', () => resolve());
        client.once('connect_error', (err) => reject(err));
      });
      expect(client.connected).toBe(true);

      // Trigger sync apply via internal endpoint (CLOUD source) → broadcast
      const newId = '66666666-6666-6666-6666-666666666661';
      const eventPromise = waitForEvent<{
        entityType: string;
        entityId: string;
        operation: string;
        source: string;
        tenantId: string;
      }>(client, 'sync.applied');

      const res = await postSync(port, {
        events: [
          {
            id: '66666666-6666-6666-6666-666666666660',
            source: 'CLOUD',
            entityType: 'patient',
            entityId: newId,
            operation: 'INSERT',
            tenantId: fixtures.tenantA.id,
            payload: {
              id: newId,
              tenant_id: fixtures.tenantA.id,
              mrn: 'WS-001',
              first_name: 'WS',
              last_name: 'Notify',
              birth_date: '1990-01-01',
              gender: 'male',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            occurredAt: new Date().toISOString(),
          },
        ],
      });
      expect(res.status).toBe(200);

      const ev = await eventPromise;
      expect(ev.entityType).toBe('patient');
      expect(ev.entityId).toBe(newId);
      expect(ev.operation).toBe('INSERT');
      expect(ev.source).toBe('CLOUD');
      expect(ev.tenantId).toBe(fixtures.tenantA.id);
    } finally {
      client.disconnect();
    }
  });

  it('tenant B JWT → tenant A event almaz (room isolation)', async () => {
    const accessTokenB = await loginTenant(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const clientB = ioClient(`http://127.0.0.1:${port}/sync`, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: accessTokenB },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        clientB.once('connect', () => resolve());
        clientB.once('connect_error', (err) => reject(err));
      });

      let received = false;
      clientB.on('sync.applied', () => {
        received = true;
      });

      // Tenant A için sync event tetikle
      const newId = '66666666-6666-6666-6666-666666666662';
      await postSync(port, {
        events: [
          {
            id: '66666666-6666-6666-6666-666666666663',
            source: 'CLOUD',
            entityType: 'patient',
            entityId: newId,
            operation: 'INSERT',
            tenantId: fixtures.tenantA.id,
            payload: {
              id: newId,
              tenant_id: fixtures.tenantA.id,
              mrn: 'WS-X-001',
              first_name: 'Cross',
              last_name: 'Tenant',
              birth_date: '1990-01-01',
              gender: 'male',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            occurredAt: new Date().toISOString(),
          },
        ],
      });

      // Kısa bekle — broadcast async; eğer cross-tenant sızıntı varsa burada
      // received true olur
      await new Promise((r) => setTimeout(r, 300));
      expect(received).toBe(false);
    } finally {
      clientB.disconnect();
    }
  });
});
