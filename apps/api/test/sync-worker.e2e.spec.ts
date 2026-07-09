import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@airmed/db';
import { SyncService } from '../src/sync/sync.service';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';

// A12 PR 2 — Worker outbound sync (LOCAL → peer) test.
//
// SyncService.runOutboundSync()'i isolated test: mock peer URL üzerinde
// global fetch'i intercept ederiz; outbox → POST → synced_at set akışını
// ve retry/backoff/dead-letter davranışını doğrularız.

const SECRET = 'test-sync-secret-32-chars-long-hello!';
const PEER_URL = 'http://mock-peer.local';

interface FetchInvocation {
  url: string;
  body: string;
  signature: string;
}

function installMockFetch(handler: (call: FetchInvocation) => Response | Promise<Response>) {
  const calls: FetchInvocation[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const body = (init?.body as string) ?? '';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const invocation: FetchInvocation = {
      url,
      body,
      signature: headers['X-Sync-Signature'] ?? '',
    };
    calls.push(invocation);
    return handler(invocation);
  }) as typeof globalThis.fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe('A12 sync worker outbound (mock peer)', () => {
  let service: SyncService;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;

  beforeAll(async () => {
    process.env.SYNC_HMAC_SECRET = SECRET;
    process.env.SYNC_PEER_URL = PEER_URL;
    process.env.SYNC_NODE_SOURCE = 'LOCAL';
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [SyncService],
    }).compile();
    service = moduleRef.get(SyncService);
  });

  beforeEach(async () => {
    // Önce patient cleanup → trigger DELETE outbox satırları yazar.
    // SONRA outbox'ı tamamen sıfırla (trigger'dan gelenler dahil).
    await prisma.patient.deleteMany({
      where: { tenantId: fixtures.tenantA.id, id: { not: fixtures.tenantA.patientId } },
    });
    await prisma.syncOutbox.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('peer URL boş → outbound sync skip eder (sent=0, no fetch)', async () => {
    process.env.SYNC_PEER_URL = '';
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [SyncService],
    }).compile();
    const isolatedService = moduleRef.get(SyncService);
    const mock = installMockFetch(() => new Response('ok', { status: 200 }));
    try {
      const result = await isolatedService.runOutboundSync();
      expect(result.sent).toBe(0);
      expect(mock.calls.length).toBe(0);
    } finally {
      mock.restore();
      process.env.SYNC_PEER_URL = PEER_URL;
    }
  });

  it('unsynced outbox event → POST peer → synced_at set + HMAC signature header', async () => {
    await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'WORKER-001',
        firstName: 'Out',
        lastName: 'Bound',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
      },
    });
    const beforeRows = await prisma.syncOutbox.findMany({ where: { syncedAt: null } });
    expect(beforeRows.length).toBe(1);

    const mock = installMockFetch(
      () =>
        new Response(JSON.stringify({ applied: 1, failed: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    try {
      const result = await service.runOutboundSync();
      expect(result.sent).toBe(1);
      expect(result.failed).toBe(0);
      expect(mock.calls.length).toBe(1);
      expect(mock.calls[0].url).toBe(`${PEER_URL}/api/internal/sync`);
      expect(mock.calls[0].signature).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    } finally {
      mock.restore();
    }

    const after = await prisma.syncOutbox.findFirst({ where: { entityType: 'patient' } });
    expect(after!.syncedAt).not.toBeNull();
    expect(after!.retryCount).toBe(0);
    expect(after!.failedAt).toBeNull();
  });

  it('#421 peer 5xx = transient → retry_count++ ama ASLA dead-letter (uzun kesinti)', async () => {
    await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'WORKER-RETRY-001',
        firstName: 'Retry',
        lastName: 'Me',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
      },
    });

    const mock = installMockFetch(() => new Response('internal error', { status: 500 }));
    try {
      // İlk run: retry_count 0 → 1, last_error dolar, synced_at null, failed_at null
      await service.runOutboundSync();
      let row = await prisma.syncOutbox.findFirstOrThrow({ where: { entityType: 'patient' } });
      expect(row.syncedAt).toBeNull();
      expect(row.retryCount).toBe(1);
      expect(row.lastError).toMatch(/HTTP 500/);
      expect(row.failedAt).toBeNull();

      // Uzun kesinti simülasyonu: 8 tur (>MAX_RETRY=5). Her turda backoff'u
      // atlamak için created_at geri çek. failed_at HİÇBİR turda set edilmemeli.
      for (let i = 2; i <= 8; i++) {
        await prisma.$executeRawUnsafe(
          `UPDATE sync_outbox SET created_at = NOW() - INTERVAL '1 hour' WHERE id = $1::uuid`,
          row.id,
        );
        await service.runOutboundSync();
        row = await prisma.syncOutbox.findFirstOrThrow({ where: { entityType: 'patient' } });
        expect(row.failedAt).toBeNull(); // transient → asla dead-letter
      }
      expect(row.retryCount).toBe(8);

      // Bağlantı dönünce (peer 200) event temiz sync olur — kayıp yok.
      mock.restore();
      const ok = installMockFetch(
        () =>
          new Response(JSON.stringify({ applied: 1, failed: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      );
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE sync_outbox SET created_at = NOW() - INTERVAL '1 hour' WHERE id = $1::uuid`,
          row.id,
        );
        const result = await service.runOutboundSync();
        expect(result.sent).toBe(1);
        row = await prisma.syncOutbox.findFirstOrThrow({ where: { entityType: 'patient' } });
        expect(row.syncedAt).not.toBeNull();
        expect(row.failedAt).toBeNull();
      } finally {
        ok.restore();
      }
    } finally {
      mock.restore();
    }
  });

  it('#421 per-event apply hatası (peer 200 + failed[]) → MAX_RETRY sonrası dead-letter', async () => {
    await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'WORKER-POISON-001',
        firstName: 'Poison',
        lastName: 'Event',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
      },
    });
    // Peer her event'i tek tek reddediyor (poison event) → bunlar dead-letter olur.
    const mock = installMockFetch((call) => {
      const body = JSON.parse(call.body) as { events: Array<{ id: string }> };
      return new Response(
        JSON.stringify({
          applied: 0,
          failed: body.events.map((e) => ({ eventId: e.id, error: 'unknown entityType' })),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    try {
      let row = await prisma.syncOutbox.findFirstOrThrow({ where: { entityType: 'patient' } });
      for (let i = 1; i <= 5; i++) {
        await prisma.$executeRawUnsafe(
          `UPDATE sync_outbox SET created_at = NOW() - INTERVAL '1 hour' WHERE id = $1::uuid`,
          row.id,
        );
        await service.runOutboundSync();
        row = await prisma.syncOutbox.findFirstOrThrow({ where: { entityType: 'patient' } });
      }
      expect(row.retryCount).toBe(5);
      expect(row.failedAt).not.toBeNull(); // poison event dead-letter olur
    } finally {
      mock.restore();
    }
  });

  it('#421 pruneSyncedOutbox sadece eski synced satırları siler', async () => {
    // 1) Eski synced row → silinmeli
    await prisma.syncOutbox.create({
      data: {
        source: 'LOCAL',
        entityType: 'patient',
        entityId: '00000000-0000-0000-0000-0000000000aa',
        operation: 'INSERT',
        payload: { id: '00000000-0000-0000-0000-0000000000aa' },
        occurredAt: new Date(),
        syncedAt: new Date(),
      },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE sync_outbox SET synced_at = NOW() - INTERVAL '30 days'
        WHERE entity_id = '00000000-0000-0000-0000-0000000000aa'::uuid`,
    );
    // 2) Yeni synced row → korunmalı (retention içinde)
    await prisma.syncOutbox.create({
      data: {
        source: 'LOCAL',
        entityType: 'patient',
        entityId: '00000000-0000-0000-0000-0000000000bb',
        operation: 'INSERT',
        payload: { id: '00000000-0000-0000-0000-0000000000bb' },
        occurredAt: new Date(),
        syncedAt: new Date(),
      },
    });
    // 3) Pending (synced_at null) eski row → ASLA silinmemeli
    await prisma.syncOutbox.create({
      data: {
        source: 'LOCAL',
        entityType: 'patient',
        entityId: '00000000-0000-0000-0000-0000000000cc',
        operation: 'INSERT',
        payload: { id: '00000000-0000-0000-0000-0000000000cc' },
        occurredAt: new Date(),
      },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE sync_outbox SET created_at = NOW() - INTERVAL '30 days'
        WHERE entity_id = '00000000-0000-0000-0000-0000000000cc'::uuid`,
    );

    const deleted = await service.pruneSyncedOutbox(7);
    expect(deleted).toBeGreaterThanOrEqual(1);

    const remaining = await prisma.syncOutbox.findMany({
      where: {
        entityId: {
          in: [
            '00000000-0000-0000-0000-0000000000aa',
            '00000000-0000-0000-0000-0000000000bb',
            '00000000-0000-0000-0000-0000000000cc',
          ],
        },
      },
      select: { entityId: true },
    });
    const ids = remaining.map((r) => r.entityId).sort();
    // aa (eski synced) silindi; bb (yeni synced) + cc (pending) kaldı
    expect(ids).toEqual([
      '00000000-0000-0000-0000-0000000000bb',
      '00000000-0000-0000-0000-0000000000cc',
    ]);
  });

  it("source ≠ nodeSource olan event'ler outbox'tan çekilmez (re-send loop engeli)", async () => {
    // CLOUD source ile manuel outbox row
    await prisma.syncOutbox.create({
      data: {
        source: 'CLOUD',
        entityType: 'patient',
        entityId: '00000000-0000-0000-0000-000000000099',
        operation: 'INSERT',
        payload: { id: '00000000-0000-0000-0000-000000000099' },
        occurredAt: new Date(),
      },
    });
    const mock = installMockFetch(
      () =>
        new Response(JSON.stringify({ applied: 1, failed: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    try {
      const result = await service.runOutboundSync();
      expect(result.sent).toBe(0); // CLOUD source skipped
      expect(mock.calls.length).toBe(0);
    } finally {
      mock.restore();
    }
  });
});
