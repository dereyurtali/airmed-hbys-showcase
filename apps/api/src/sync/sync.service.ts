import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@airmed/db';
import { AdminPrismaService } from '../prisma/admin-prisma.service';
import { assertColumnAllowedForTable, assertSyncColumnsSafe } from './sync-column-allowlist';
import { signSyncBody } from './sync-hmac';
import { SyncGateway } from './sync.gateway';
import type { SyncBatch, SyncBatchResult, SyncEvent } from './sync.types';

// A12 — Sync service: outbox okuma + remote POST + receive apply.
//
// Receive (karşı node'dan gelen event'leri uygula):
// - session_replication_role = replica → trigger fire etmez → sonsuz döngü yok
// - Generic INSERT ON CONFLICT (id) DO UPDATE … (dinamik SQL, payload keys = columns)
// - DELETE → DELETE FROM table WHERE id = $1 (idempotent: not-found ignored)
//
// Send (worker tarafı):
// - Outbox'tan unsynced + retry-eligible event'leri çek
// - Batch (default 50) halinde peer'a POST
// - Cevap 2xx → synced_at set
// - Per-event apply hatası (peer 200 + failed[]) → retryCount++, MAX_RETRY sonrası
//   failed_at (dead-letter): gerçekten bozuk event kuyruğu tıkamasın.
// - Transport hatası (network / herhangi non-2xx / peer down) → retryCount++ ama
//   ASLA failed_at YOK. #421: uzun internet kesintisinde batch dead-letter olmaz;
//   bağlantı dönünce temiz devam eder. Backoff exp ama MAX_BACKOFF_SEC ile capped
//   → kesinti saatlerce sürse de ~5 dk'da bir tekrar dener, kuyruk kaybolmaz.

const MAX_BATCH_SIZE = 50;
const MAX_RETRY = 5;
const BASE_BACKOFF_SEC = 2;
// #421 — backoff tavanı: 2^retry sınırsız büyümesin (uzun kesintide 2^20 sn =
// günler olur, bağlantı dönse bile tekrar denemez). 5 dk tavan = makul.
const MAX_BACKOFF_SEC = 300;
// #421 — synced outbox satırları için saklama. Worker günlük prune ile teslim
// edilmiş (synced_at set) eski satırları siler → tablo şişmez. SyncConflict
// dokunulmaz (audit).
const DEFAULT_OUTBOX_RETENTION_DAYS = 7;
// #934 — peer YOKKEN (dormant) synced_at IS NULL satırları için yaş-bazlı
// retention. Normal prune yalnız synced_at set satırları siler; peer'sız kutuda
// bu satırlar hiç synced olmaz → dormant prune olmadan sınırsız birikir.
const DEFAULT_DORMANT_OUTBOX_RETENTION_DAYS = 30;

// Whitelist: receive endpoint sadece bu tablolara uygulayabilir. Yeni bir
// entityType eklemek için hem trigger (PR 1) hem buraya eklenir.
const ENTITY_TYPE_TO_TABLE: Record<string, string> = {
  patient: 'patients',
  appointment: 'appointments',
  examination: 'examinations',
  surgery: 'surgeries',
  measurement: 'measurements',
  preOp: 'pre_ops',
  procedure: 'procedures',
  labTest: 'lab_tests',
  prescription: 'prescriptions',
  iolModel: 'iol_models',
  iolLot: 'iol_lots',
  iolStockMovement: 'iol_stock_movements',
  patientPhoto: 'patient_photos',
  consentSigning: 'consent_signings',
  consentTemplate: 'consent_templates',
  doctor: 'doctors',
  doctorAvailability: 'doctor_availabilities',
  doctorLeave: 'doctor_leaves',
  user: 'users',
  role: 'roles',
  commissionRule: 'commission_rules',
  commissionEntry: 'commission_entries',
};

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private readonly hmacSecret: string;
  private readonly peerUrl: string | null;
  private readonly nodeSource: string;
  // table_name -> { column_name -> udt_name } cache. Cold start'ta
  // information_schema'dan doldurulur. Enum/uuid/jsonb gibi non-text
  // tipler için cast adı buradan üretilir.
  private readonly columnTypeCache = new Map<string, Map<string, string>>();

  // Admin client (RLS bypass) — cross-tenant + receive uygulamasında her
  // tenant satırına yazılır. #1065 — paylaşımlı AdminPrismaService (tek havuz).
  constructor(
    config: ConfigService,
    private readonly admin: AdminPrismaService,
    // Gateway @Optional çünkü unit testlerde DI olmadan SyncService instance
    // edilebiliyor (sync-worker.e2e.spec.ts gibi). null kontrolü her
    // broadcast call'unda var.
    @Optional() private readonly gateway?: SyncGateway,
  ) {
    this.hmacSecret = config.get<string>('SYNC_HMAC_SECRET') ?? '';
    this.peerUrl = config.get<string>('SYNC_PEER_URL') ?? null;
    this.nodeSource = config.get<string>('SYNC_NODE_SOURCE') ?? 'LOCAL';
  }

  getNodeSource(): string {
    return this.nodeSource;
  }

  getHmacSecret(): string {
    return this.hmacSecret;
  }

  isPeerConfigured(): boolean {
    return !!this.peerUrl;
  }

  // ---------------- Send (worker tarafı) ----------------

  // Worker'ın çağırdığı tek public yöntem. Kendi node'umuzdan kaynaklanan,
  // henüz sync edilmemiş ve backoff suresi dolmus event'leri batch'le.
  async runOutboundSync(): Promise<{ sent: number; failed: number }> {
    if (!this.peerUrl) {
      return { sent: 0, failed: 0 };
    }
    if (!this.hmacSecret) {
      this.logger.warn('SYNC_HMAC_SECRET not set, skipping outbound sync');
      return { sent: 0, failed: 0 };
    }

    const events = await this.fetchUnsyncedBatch();
    if (events.length === 0) return { sent: 0, failed: 0 };

    const batch: SyncBatch = { events };
    const body = JSON.stringify(batch);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signSyncBody(this.hmacSecret, body, timestamp);

    try {
      const res = await fetch(`${this.peerUrl}/api/internal/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sync-Signature': signature,
          'X-Sync-Timestamp': timestamp,
        },
        body,
      });
      if (!res.ok) {
        // #421 — whole-batch non-2xx = transport/peer sorunu (peer down, auth,
        // 5xx). Peer event'leri tek tek değerlendirmedi → transient. Dead-letter
        // YOK; capped backoff ile sonsuz retry. Uzun kesinti = veri kaybı değil.
        const errText = await res.text().catch(() => '');
        await this.markBatchTransient(events, `HTTP ${res.status}: ${errText.slice(0, 200)}`);
        return { sent: 0, failed: events.length };
      }
      const result = (await res.json()) as SyncBatchResult;
      await this.markBatchPartial(events, result);
      const failedCount = result.failed?.length ?? 0;
      return { sent: events.length - failedCount, failed: failedCount };
    } catch (err) {
      // Network throw (DNS, connection refused, timeout) = klasik internet
      // kesintisi → transient, dead-letter YOK.
      const msg = err instanceof Error ? err.message : String(err);
      await this.markBatchTransient(events, `network: ${msg.slice(0, 200)}`);
      return { sent: 0, failed: events.length };
    }
  }

  private async fetchUnsyncedBatch(): Promise<SyncEvent[]> {
    // En eski createdAt'ten başla. Yalnız bu node'un yarattığı event'ler
    // (source = nodeSource) — karşı node'dan alıp uyguladığımız event'leri
    // (source != nodeSource) tekrar göndermiyoruz.
    // Backoff: retry_count > 0 olanlar için createdAt + 2^retry_count saniye
    // henüz geçmediyse skip.
    const rows = await this.admin.$queryRaw<
      Array<{
        id: string;
        source: string;
        entity_type: string;
        entity_id: string;
        operation: string;
        tenant_id: string | null;
        payload: Record<string, unknown>;
        occurred_at: Date;
        retry_count: number;
      }>
    >`
      SELECT id, source, entity_type, entity_id, operation, tenant_id,
             payload, occurred_at, retry_count
      FROM sync_outbox
      WHERE synced_at IS NULL
        AND failed_at IS NULL
        AND source = ${this.nodeSource}
        AND (
          retry_count = 0
          OR created_at + (LEAST(${BASE_BACKOFF_SEC} * power(2, retry_count), ${MAX_BACKOFF_SEC}) || ' seconds')::interval <= NOW()
        )
      ORDER BY created_at ASC
      LIMIT ${MAX_BATCH_SIZE}
    `;
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      entityType: r.entity_type,
      entityId: r.entity_id,
      operation: r.operation as 'INSERT' | 'UPDATE' | 'DELETE',
      tenantId: r.tenant_id,
      payload: r.payload,
      occurredAt: r.occurred_at.toISOString(),
    }));
  }

  // #421 — transport/transient hata: retry_count++ (backoff için) ama failed_at
  // ASLA set edilmez. Uzun kesinti boyunca event'ler retryable kalır; bağlantı
  // dönünce capped backoff penceresinde tekrar denenir ve sync olur.
  private async markBatchTransient(events: SyncEvent[], error: string): Promise<void> {
    const ids = events.map((e) => e.id);
    if (ids.length === 0) return;
    await this.admin.$executeRaw`
      UPDATE sync_outbox
         SET retry_count = retry_count + 1,
             last_error  = ${error}
       WHERE id::text = ANY(${ids})
    `;
  }

  private async markBatchPartial(events: SyncEvent[], result: SyncBatchResult): Promise<void> {
    const failedMap = new Map(result.failed?.map((f) => [f.eventId, f.error]) ?? []);
    const successIds = events.map((e) => e.id).filter((id) => !failedMap.has(id));
    const failedEvents = events.filter((e) => failedMap.has(e.id));

    if (successIds.length > 0) {
      await this.admin.$executeRaw`
        UPDATE sync_outbox
           SET synced_at = NOW(), last_error = NULL
         WHERE id::text = ANY(${successIds})
      `;
    }
    for (const e of failedEvents) {
      const error = failedMap.get(e.id) ?? 'unknown';
      await this.admin.$executeRaw`
        UPDATE sync_outbox
           SET retry_count = retry_count + 1,
               last_error  = ${error},
               failed_at   = CASE WHEN retry_count + 1 >= ${MAX_RETRY} THEN NOW() ELSE NULL END
         WHERE id::text = ${e.id}
      `;
    }
  }

  // ---------------- Receive (karşı node'dan gelen apply) ----------------

  async applyBatch(batch: SyncBatch): Promise<SyncBatchResult> {
    if (!Array.isArray(batch?.events)) {
      throw new BadRequestException('Invalid batch: events array required');
    }
    let applied = 0;
    const failed: SyncBatchResult['failed'] = [];

    // Tüm batch tek transaction'da: replication-mode trigger'ları devre dışı
    // bırakır → uyguladığımız event'ler outbox'a tekrar yazılmaz (sonsuz
    // döngü engeli).
    //
    // P0 2.9 — Per-event SAVEPOINT: bir event fail olursa sadece o event'in
    // değişiklikleri rollback, kalan event'ler uygulanır. Eskiden try/catch
    // yalnız JS exception'ını yakalıyordu; PG transaction abort state'inde
    // (current transaction aborted) takip eden tüm event'ler ezbere fail
    // ediyordu → 50-event batch'inde 1. event fail = 49 zombie + sender
    // tarafında 'applied' varsayımı → veri kaybı.
    await this.admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
      for (let i = 0; i < batch.events.length; i++) {
        const ev = batch.events[i];
        const savepoint = `ev_${i}`;
        await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
        try {
          await this.applyEvent(tx, ev);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
          applied++;
        } catch (err) {
          // ROLLBACK TO SAVEPOINT: tx aborted state'ten kurtarır, kalan
          // event'ler clean state'te devam eder.
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          failed.push({
            eventId: ev.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });

    return { applied, failed };
  }

  // #920 — Gelen event'in tenant'ı bu node'da bilinen (silinmemiş) bir tenant
  // olmalı. Sync yalnız MEVCUT tenant'ların güncellemesini taşır; yeni tenant
  // sync ile yaratılmaz (F3 onboarding). Geçerli HMAC'li bir peer bile bu node'a
  // ait olmayan / rastgele bir tenant_id için veri enjekte edemesin. Payload'daki
  // tenant_id de ev.tenantId ile tutarlı olmalı (cross-tenant payload engeli).
  private async assertEventTenantAllowed(
    tx: Pick<PrismaClient, '$queryRawUnsafe'>,
    ev: SyncEvent,
  ): Promise<void> {
    if (!ev.tenantId) {
      throw new Error(`Sync event missing tenantId (${ev.entityType}/${ev.entityId})`);
    }
    const rows = await tx.$queryRawUnsafe<Array<{ one: number }>>(
      `SELECT 1 AS one FROM tenants WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
      ev.tenantId,
    );
    if (rows.length === 0) {
      throw new Error(`Sync event for unknown/unavailable tenant: ${ev.tenantId}`);
    }
    const payloadTenant = (ev.payload as Record<string, unknown> | undefined)?.tenant_id;
    if (payloadTenant != null && payloadTenant !== ev.tenantId) {
      throw new Error(
        `Sync payload tenant_id mismatch: ${String(payloadTenant)} != ${ev.tenantId}`,
      );
    }
  }

  private async applyEvent(
    tx: Pick<PrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe'>,
    ev: SyncEvent,
  ): Promise<void> {
    const table = ENTITY_TYPE_TO_TABLE[ev.entityType];
    if (!table) throw new Error(`Unknown entityType: ${ev.entityType}`);

    // #920 — cross-tenant / rastgele-tenant enjeksiyonu engeli.
    await this.assertEventTenantAllowed(tx, ev);

    if (ev.operation === 'DELETE') {
      // Idempotent + tenant-scoped: yalnız kendi (doğrulanmış) tenant'ının kaydını siler.
      await tx.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        ev.entityId,
        ev.tenantId,
      );
      return;
    }

    // Conflict resolution (A12 PR 3):
    // - delete_update: gelen UPDATE local'de silinmiş satır → DELETE kazanır
    //   plan kuralı → conflict yaz + skip.
    // - lww_stale: mevcut satırın updated_at'i gelen occurredAt'ten yeni →
    //   local kazandı → conflict yaz + skip.
    // - unique_create: aynı unique field (patient.mrn) farklı id → manuel
    //   resolution gerek → conflict yaz + skip.
    const existing = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "${table}" WHERE id = $1::uuid LIMIT 1`,
      ev.entityId,
    );
    const localRow = existing[0];

    if (ev.operation === 'UPDATE' && !localRow) {
      // delete_update: local'de silinmiş → DELETE kazanır (plan kuralı)
      await this.recordConflict(tx, ev, 'delete_update', null);
      return;
    }

    if (localRow) {
      // #421 — local↔cloud çakışma politikası: bu node da AYNI entity için
      // henüz push edilmemiş bir UPDATE biriktirmişse (iki taraf da kesinti
      // sırasında değiştirdi) → bu gerçek concurrent edit. LWW timestamp'e
      // GÜVENME (newer cloud timestamp offline klinik düzenlemesini sessizce
      // ezerdi) → conflict yaz + skip, manuel resolution. Politika: hiçbir
      // çift-taraflı düzenleme sessizce kaybolmaz.
      if (
        ev.operation === 'UPDATE' &&
        (await this.hasPendingLocalUpdate(tx, ev.entityType, ev.entityId))
      ) {
        await this.recordConflict(tx, ev, 'concurrent_update', localRow);
        return;
      }
      // Tek-taraflı değişiklik → LWW: local newer ise local kazanır (skip).
      const localUpdatedAt = (localRow.updated_at ?? localRow.created_at) as Date | string | null;
      if (localUpdatedAt) {
        const localMs = new Date(localUpdatedAt).getTime();
        const remoteMs = new Date(ev.occurredAt).getTime();
        if (localMs > remoteMs) {
          await this.recordConflict(tx, ev, 'lww_stale', localRow);
          return;
        }
      }
    }

    // unique_create: patient için mrn ve phone collision. Sadece INSERT'ta;
    // UPDATE same-id zaten ON CONFLICT id DO UPDATE ile halloluyor.
    if (ev.operation === 'INSERT' && ev.entityType === 'patient' && !localRow) {
      const mrn = ev.payload.mrn as string | undefined;
      if (mrn) {
        const dupe = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM "patients" WHERE mrn = $1 AND id != $2::uuid LIMIT 1`,
          mrn,
          ev.entityId,
        );
        if (dupe.length > 0) {
          await this.recordConflict(tx, ev, 'unique_create', null);
          return;
        }
      }
    }

    const colTypes = await this.getColumnTypes(tx, table);

    // INSERT veya UPDATE → UPSERT (ON CONFLICT id DO UPDATE)
    const columns = Object.keys(ev.payload);
    if (columns.length === 0) throw new Error('Empty payload');
    // S14 — v0.1 port: SQL injection guard. Regex hard-block + opsiyonel
    // per-table allowlist. Karşı node compromised olsa bile column adıyla
    // SQL enjekte edemez.
    assertSyncColumnsSafe(columns);
    for (const c of columns) assertColumnAllowedForTable(table, c);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    columns.forEach((c, idx) => {
      const v = ev.payload[c];
      const udt = colTypes.get(c);
      placeholders.push(`$${idx + 1}${pgCastFromUdt(udt, v)}`);
      // jsonb/json için object'i stringify
      values.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
    });
    const colList = columns.map((c) => `"${c}"`).join(', ');
    const updates = columns
      .filter((c) => c !== 'id')
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
      .join(', ');

    const sql = `
      INSERT INTO "${table}" (${colList})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO UPDATE SET ${updates}
    `;
    await tx.$executeRawUnsafe(sql, ...values);
    // F4 PR 4 — Real-time broadcast: tenant UI subscribe ediyor.
    this.gateway?.broadcastApplied({
      tenantId: ev.tenantId,
      entityType: ev.entityType,
      entityId: ev.entityId,
      operation: ev.operation,
      source: ev.source,
    });
  }

  // #421 — bu node'un aynı entity için henüz sync edilmemiş bir UPDATE'i var mı?
  // Varsa gelen remote UPDATE ile çift-taraflı concurrent edit demektir. INSERT
  // pending sayılmaz (yeni kayıt; stale remote update LWW ile çözülür).
  private async hasPendingLocalUpdate(
    tx: Pick<PrismaClient, '$queryRawUnsafe'>,
    entityType: string,
    entityId: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRawUnsafe<Array<{ one: number }>>(
      `SELECT 1 AS one FROM sync_outbox
        WHERE entity_type = $1 AND entity_id = $2::uuid
          AND source = $3 AND operation = 'UPDATE'
          AND synced_at IS NULL AND failed_at IS NULL
        LIMIT 1`,
      entityType,
      entityId,
      this.nodeSource,
    );
    return rows.length > 0;
  }

  private async recordConflict(
    tx: Pick<PrismaClient, '$executeRawUnsafe'>,
    ev: SyncEvent,
    conflictType: 'lww_stale' | 'unique_create' | 'delete_update' | 'concurrent_update',
    localSnapshot: Record<string, unknown> | null,
  ): Promise<void> {
    // delete_update auto-resolve (LOCAL kazandı, manuel müdahale gerekmez).
    // concurrent_update + lww_stale + unique_create → manuel resolution (resolved_at null).
    const autoResolve = conflictType === 'delete_update';
    await tx.$executeRawUnsafe(
      `INSERT INTO sync_conflicts (
         id, event_id, entity_type, entity_id, tenant_id,
         conflict_type, remote_source, local_snapshot, remote_snapshot,
         occurred_at, resolved_at, resolution
       ) VALUES (
         gen_random_uuid(), $1::uuid, $2, $3::uuid, $4::uuid,
         $5, $6, $7::jsonb, $8::jsonb,
         $9::timestamp, $10, $11
       )`,
      ev.id,
      ev.entityType,
      ev.entityId,
      ev.tenantId,
      conflictType,
      ev.source,
      localSnapshot ? JSON.stringify(localSnapshot) : null,
      JSON.stringify(ev.payload),
      ev.occurredAt,
      autoResolve ? new Date() : null,
      autoResolve ? 'auto_local' : null,
    );
    this.gateway?.broadcastConflict({
      tenantId: ev.tenantId,
      entityType: ev.entityType,
      entityId: ev.entityId,
      conflictType,
    });
  }

  // ---------------- Status (tenant UI offline banner) ----------------

  async getStatus(tenantId: string): Promise<{
    outboxPending: number;
    outboxFailed: number;
    lastSyncAt: Date | null;
    oldestPendingAt: Date | null;
    peerConfigured: boolean;
  }> {
    const [pending, failed, lastSynced, oldestPending] = await Promise.all([
      this.admin.syncOutbox.count({
        where: { tenantId, syncedAt: null, failedAt: null },
      }),
      this.admin.syncOutbox.count({ where: { tenantId, failedAt: { not: null } } }),
      this.admin.syncOutbox.findFirst({
        where: { tenantId, syncedAt: { not: null } },
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
      // #421 — en eski bekleyen event: UI "X dakikadır kesinti" gösterebilsin,
      // uzun kesinti operatöre görünür olsun.
      this.admin.syncOutbox.findFirst({
        where: { tenantId, syncedAt: null, failedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    return {
      outboxPending: pending,
      outboxFailed: failed,
      lastSyncAt: lastSynced?.syncedAt ?? null,
      oldestPendingAt: oldestPending?.createdAt ?? null,
      peerConfigured: !!this.peerUrl,
    };
  }

  // #421 — Outbox hijyeni: teslim edilmiş (synced_at set) eski satırları sil →
  // tablo uzun vadede şişmez. Sadece synced rowlar; pending/failed dokunulmaz.
  // Worker günde bir çağırır. Batch'li DELETE (LIMIT) tek seferde tabloyu
  // kilitlemesin diye.
  async pruneSyncedOutbox(retentionDays = DEFAULT_OUTBOX_RETENTION_DAYS): Promise<number> {
    const cutoffDays = Math.max(1, retentionDays);
    let totalDeleted = 0;
    // Her turda en fazla 5000 satır sil; tablo kilidini kısa tut.
    for (;;) {
      const deleted = await this.admin.$executeRawUnsafe(
        `DELETE FROM sync_outbox
          WHERE id IN (
            SELECT id FROM sync_outbox
             WHERE synced_at IS NOT NULL
               AND synced_at < NOW() - ($1 || ' days')::interval
             LIMIT 5000
          )`,
        String(cutoffDays),
      );
      totalDeleted += deleted;
      if (deleted < 5000) break;
    }
    return totalDeleted;
  }

  // #934 — Dormant retention. Peer YAPILANDIRILMAMIŞ (SYNC_PEER_URL boş) bir
  // kutuda trigger'lar outbox'ı doldurur ama worker no-op → synced_at hep NULL,
  // normal prune (synced_at IS NOT NULL) hiç silmez → sınırsız birikim. A12
  // aktive edildiğinde başlangıç durumu kutu-içi snapshot/restore ile bootstrap
  // edilir (aktivasyon-öncesi outbox replay'i DEĞİL) → bu satırlar A12 için
  // gerekmez. Bu yüzden peer yokken synced_at IS NULL satırları da yaş-bazlı
  // budanır. Peer VARSA no-op (o satırlar teslim bekliyor, yaşla silinmez).
  async pruneDormantOutbox(retentionDays = DEFAULT_DORMANT_OUTBOX_RETENTION_DAYS): Promise<number> {
    if (this.isPeerConfigured()) return 0;
    const cutoffDays = Math.max(1, retentionDays);
    let totalDeleted = 0;
    for (;;) {
      const deleted = await this.admin.$executeRawUnsafe(
        `DELETE FROM sync_outbox
          WHERE id IN (
            SELECT id FROM sync_outbox
             WHERE synced_at IS NULL
               AND created_at < NOW() - ($1 || ' days')::interval
             LIMIT 5000
          )`,
        String(cutoffDays),
      );
      totalDeleted += deleted;
      if (deleted < 5000) break;
    }
    return totalDeleted;
  }

  // #934 — Outbox derinlik metriği (operasyon gözlemi + staging monitör paneli,
  // #928 ile koordine). total + unsynced (synced_at NULL) + failed satır sayısı.
  async outboxDepth(): Promise<{ total: number; unsynced: number; failed: number }> {
    const rows = await this.admin.$queryRawUnsafe<
      { total: bigint; unsynced: bigint; failed: bigint }[]
    >(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE synced_at IS NULL) AS unsynced,
              count(*) FILTER (WHERE failed_at IS NOT NULL) AS failed
         FROM sync_outbox`,
    );
    return {
      total: Number(rows[0].total),
      unsynced: Number(rows[0].unsynced),
      failed: Number(rows[0].failed),
    };
  }

  // ---------------- Conflict queue (admin UI) ----------------

  async listConflicts(opts: { resolved?: boolean; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const where =
      opts.resolved === undefined
        ? {}
        : opts.resolved
          ? { resolvedAt: { not: null } }
          : { resolvedAt: null };
    return this.admin.syncConflict.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async resolveConflict(
    id: string,
    resolution: 'local_kept' | 'remote_applied',
    resolvedById: string,
  ): Promise<{ ok: true }> {
    const conflict = await this.admin.syncConflict.findUnique({ where: { id } });
    if (!conflict) throw new BadRequestException('Conflict not found');
    if (conflict.resolvedAt) return { ok: true }; // idempotent

    if (resolution === 'remote_applied') {
      // Remote payload'ı zorla uygula → apply with conflict checks BYPASSED
      const table = ENTITY_TYPE_TO_TABLE[conflict.entityType];
      if (!table) throw new BadRequestException(`Unknown entityType: ${conflict.entityType}`);
      const payload = conflict.remoteSnapshot as Record<string, unknown>;
      await this.admin.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
        const colTypes = await this.getColumnTypes(tx, table);
        const columns = Object.keys(payload);
        // S14 — v0.1 port: aynı SQL injection guard'ı conflict resolve sırasında da
        assertSyncColumnsSafe(columns);
        for (const c of columns) assertColumnAllowedForTable(table, c);
        const values: unknown[] = [];
        const placeholders: string[] = [];
        columns.forEach((c, idx) => {
          const v = payload[c];
          placeholders.push(`$${idx + 1}${pgCastFromUdt(colTypes.get(c), v)}`);
          values.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
        });
        const colList = columns.map((c) => `"${c}"`).join(', ');
        const updates = columns
          .filter((c) => c !== 'id')
          .map((c) => `"${c}" = EXCLUDED."${c}"`)
          .join(', ');
        const sql = `
          INSERT INTO "${table}" (${colList})
          VALUES (${placeholders.join(', ')})
          ON CONFLICT (id) DO UPDATE SET ${updates}
        `;
        await tx.$executeRawUnsafe(sql, ...values);
      });
    }
    // local_kept → just mark resolved (no DB change)

    await this.admin.syncConflict.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedById, resolution },
    });
    return { ok: true };
  }

  private async getColumnTypes(
    tx: Pick<PrismaClient, '$queryRawUnsafe'>,
    table: string,
  ): Promise<Map<string, string>> {
    const cached = this.columnTypeCache.get(table);
    if (cached) return cached;
    const rows = await tx.$queryRawUnsafe<Array<{ column_name: string; udt_name: string }>>(
      `SELECT column_name, udt_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      table,
    );
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.column_name, r.udt_name);
    this.columnTypeCache.set(table, map);
    return map;
  }
}

// PG udt_name → cast string. Whitelisted; bilinmeyen tipler için cast yok
// (text default; PG implicit cast'i halleder, örn. int4/numeric/varchar).
function pgCastFromUdt(udt: string | undefined, _value: unknown): string {
  if (!udt) return '';
  switch (udt) {
    case 'uuid':
      return '::uuid';
    case 'jsonb':
      return '::jsonb';
    case 'json':
      return '::json';
    case 'bool':
      return '::boolean';
    case 'date':
      return '::date';
    case 'timestamp':
    case 'timestamptz':
      return `::${udt}`;
    case 'inet':
      return '::inet';
    default:
      // Enum tipi (Prisma tarafından quoted: "Gender", "TenantStatus", vb.)
      // udt_name PG'de quote'suz döner. Cast'te quote zorunlu.
      // Bilinen yerleşik tipler dışında her şey muhtemelen enum.
      if (BUILTIN_UDTS.has(udt)) return '';
      return `::"${udt}"`;
  }
}

const BUILTIN_UDTS = new Set([
  'int2',
  'int4',
  'int8',
  'numeric',
  'float4',
  'float8',
  'varchar',
  'text',
  'char',
  'bpchar',
  'name',
  'bytea',
  'oid',
  'time',
  'interval',
]);
