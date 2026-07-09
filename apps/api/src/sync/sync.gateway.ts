import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getAllowedOrigins } from '../common/allowed-origins';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/auth.types';

// A12 PR 4 — WebSocket gateway, /sync namespace.
//
// Tasarım:
// - Connection handshake'inde JWT doğrulanır (`auth.token` socket.io 4.x
//   API'sından okur; query fallback yok — explicit auth).
// - Bağlı client tenant_id room'una otomatik join eder; broadcast'ler tenant-
//   scoped (cross-tenant sızıntı yok).
// - Event'ler:
//   - `sync.applied`  : karşı node'dan event'ler uygulandı (real-time refresh)
//   - `sync.conflict` : conflict tespit edildi (admin queue notify)
//   - `sync.outbox`   : kendi outbox'umuzdan event peer'a iletildi
//
// CORS: tenant UI (5173) + admin UI (5174). Production'da nginx
// `WEB_ORIGIN` / `ADMIN_ORIGIN` env'leri kullanır.

export interface SyncBroadcastPayload {
  tenantId: string | null;
  entityType: string;
  entityId: string;
  operation: string;
  source: string;
}

export interface SyncConflictBroadcastPayload {
  tenantId: string | null;
  entityType: string;
  entityId: string;
  conflictType: string;
}

// S15b — Notification broadcast. Tenant room'a yayılır; client kendi
// recipientUserId'sine göre filtreler (per-user room yerine tenant-room +
// client filtre; sync.applied ile aynı desen, pilot için yeterli).
export interface NotificationBroadcastPayload {
  tenantId: string;
  recipientUserId: string;
  notification: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    payload: unknown;
    readAt: string | null;
    createdAt: string;
  };
}

@WebSocketGateway({
  namespace: '/sync',
  // #937 — origin:true anti-pattern yerine REST ile aynı allowedOrigins whitelist
  // (JWT auth zaten var, ama origin whitelist defense-in-depth).
  cors: {
    origin: getAllowedOrigins(),
    credentials: true,
  },
})
export class SyncGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SyncGateway.name);
  private readonly accessSecret: string;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    const secret = config.get<string>('JWT_ACCESS_SECRET');
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not set');
    this.accessSecret = secret;
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) {
        client.emit('error', 'missing token');
        client.disconnect(true);
        return;
      }
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.accessSecret,
      });
      if (!payload.tenantId) {
        client.emit('error', 'invalid tenant');
        client.disconnect(true);
        return;
      }
      const room = roomFor(payload.tenantId);
      await client.join(room);
      client.data.tenantId = payload.tenantId;
      client.data.userId = payload.sub;
      this.logger.debug(`socket ${client.id} joined ${room} as ${payload.email}`);
    } catch (err) {
      this.logger.warn(`socket auth failed: ${(err as Error).message}`);
      client.emit('error', 'auth failed');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`socket ${client.id} disconnected`);
  }

  // Broadcast helpers (SyncService bunları çağırır)

  broadcastApplied(payload: SyncBroadcastPayload): void {
    if (!this.server) return;
    const room = payload.tenantId ? roomFor(payload.tenantId) : null;
    if (!room) return; // platform-wide event yok; tenant scope zorunlu
    this.server.to(room).emit('sync.applied', payload);
  }

  broadcastConflict(payload: SyncConflictBroadcastPayload): void {
    if (!this.server) return;
    const room = payload.tenantId ? roomFor(payload.tenantId) : null;
    if (!room) return;
    this.server.to(room).emit('sync.conflict', payload);
  }

  broadcastOutboxSynced(payload: SyncBroadcastPayload): void {
    if (!this.server) return;
    const room = payload.tenantId ? roomFor(payload.tenantId) : null;
    if (!room) return;
    this.server.to(room).emit('sync.outbox', payload);
  }

  // S15b — NotificationService insert sonrası çağırır. Tenant room'a `notification.new`
  // yayar; client payload.recipientUserId === kendi sub'ı ise işler.
  broadcastNotification(payload: NotificationBroadcastPayload): void {
    if (!this.server) return;
    this.server.to(roomFor(payload.tenantId)).emit('notification.new', payload);
  }

  /**
   * S15-PR12 — Ölçüm hemşiresi fulfill yapınca doktor ekranında "ölçüm hazır"
   * bildirimi. Tenant room'a broadcast; client doctor.userId === payload.doctorUserId
   * ile filtreler ve invalidate + glow/toast tetikler.
   */
  broadcastMeasurementReady(payload: {
    tenantId: string;
    patientId: string;
    doctorUserId: string | null;
    encounterId: string | null;
    orderId: string;
  }): void {
    if (!this.server) return;
    this.server.to(roomFor(payload.tenantId)).emit('measurement.ready', payload);
  }

  /**
   * #363 — Yeni ölçüm talebi oluşunca ölçüm istasyonuna anlık haber. Tenant
   * room'a broadcast; ölçüm istasyonu client'ı `measurementOrder.listForUnit`
   * query'sini invalidate eder (30 sn poll'u beklemeden) + sesli/görsel uyarı.
   */
  broadcastMeasurementOrdered(payload: {
    tenantId: string;
    patientId: string;
    orderId: string;
  }): void {
    if (!this.server) return;
    this.server.to(roomFor(payload.tenantId)).emit('measurement.ordered', payload);
  }

  private extractToken(client: Socket): string | null {
    const authToken = (client.handshake.auth as { token?: string })?.token;
    if (authToken) return authToken;
    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return null;
  }
}

function roomFor(tenantId: string): string {
  return `tenant:${tenantId}`;
}
