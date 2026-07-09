import type { ConfigService } from '@nestjs/config';
import type { AdminPrismaService } from '../prisma/admin-prisma.service';
import { SyncService } from './sync.service';

// #938 — SyncService outbound (worker) davranış testi. Kilitlenen kurallar:
// peer'sız/secret'siz no-op, başarılı batch'te synced_at işaretleme, transport
// hatasında retry sayacı artar ama ASLA failed_at set edilmez (#421 dead-letter
// yasağı), peer'ın tek tek reddettiği event'lerde MAX_RETRY sonrası failed_at,
// dormant prune'un yalnız peer YOKKEN çalışması.

const PEER = 'https://peer.example.com';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

interface AdminMock {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  $executeRawUnsafe: jest.Mock;
}

function makeAdmin(over: Partial<AdminMock> = {}): AdminMock {
  return {
    $queryRaw: over.$queryRaw ?? jest.fn().mockResolvedValue([]),
    $executeRaw: over.$executeRaw ?? jest.fn().mockResolvedValue(0),
    $executeRawUnsafe: over.$executeRawUnsafe ?? jest.fn().mockResolvedValue(0),
  };
}

function makeService(
  config: Record<string, string | undefined>,
  admin: AdminMock = makeAdmin(),
): { service: SyncService; admin: AdminMock } {
  const service = new SyncService(makeConfig(config), admin as unknown as AdminPrismaService);
  return { service, admin };
}

function outboxRow(id: string) {
  return {
    id,
    source: 'LOCAL',
    entity_type: 'patient',
    entity_id: '22222222-2222-2222-2222-222222222222',
    operation: 'UPDATE',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    payload: { id: '22222222-2222-2222-2222-222222222222', name: 'X' },
    occurred_at: new Date('2026-07-04T10:00:00Z'),
    retry_count: 0,
  };
}

// $executeRaw tagged-template olarak çağrılır → ilk argüman SQL parçaları.
function sqlOf(call: unknown[]): string {
  return (call[0] as string[]).join(' ');
}

describe('SyncService outbound (#938)', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  it('SYNC_PEER_URL yoksa → no-op: DB`ye ve ağa hiç dokunmaz', async () => {
    const { service, admin } = makeService({ SYNC_HMAC_SECRET: 's3cret' });
    expect(service.isPeerConfigured()).toBe(false);
    await expect(service.runOutboundSync()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(admin.$queryRaw).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('peer var ama SYNC_HMAC_SECRET yok → imzasız gönderim YAPILMAZ (no-op)', async () => {
    const { service, admin } = makeService({ SYNC_PEER_URL: PEER });
    await expect(service.runOutboundSync()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(admin.$queryRaw).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('outbox boşsa → gönderim yok, {sent:0, failed:0}', async () => {
    const { service } = makeService({ SYNC_PEER_URL: PEER, SYNC_HMAC_SECRET: 's3cret' });
    await expect(service.runOutboundSync()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('başarılı teslim: imzalı POST + tüm batch synced_at işaretlenir', async () => {
    const admin = makeAdmin({
      $queryRaw: jest.fn().mockResolvedValue([outboxRow('e1'), outboxRow('e2')]),
    });
    const { service } = makeService(
      { SYNC_PEER_URL: PEER, SYNC_HMAC_SECRET: 's3cret', SYNC_NODE_SOURCE: 'LOCAL' },
      admin,
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ applied: 2, failed: [] }),
    });

    await expect(service.runOutboundSync()).resolves.toEqual({ sent: 2, failed: 0 });

    // Doğru endpoint + HMAC imza header'ları.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${PEER}/api/internal/sync`);
    expect(init.headers['X-Sync-Signature']).toEqual(expect.any(String));
    expect(init.headers['X-Sync-Timestamp']).toMatch(/^\d+$/);
    expect(JSON.parse(init.body).events).toHaveLength(2);

    // synced_at set eden tek UPDATE; failed_at hiçbir yerde geçmez.
    expect(admin.$executeRaw).toHaveBeenCalledTimes(1);
    const sql = sqlOf(admin.$executeRaw.mock.calls[0]);
    expect(sql).toContain('synced_at = NOW()');
    expect(sql).not.toContain('failed_at');
    expect(admin.$executeRaw.mock.calls[0][1]).toEqual(['e1', 'e2']);
  });

  it('non-2xx cevap = transport hatası: retry_count artar, failed_at ASLA set edilmez (#421)', async () => {
    const admin = makeAdmin({ $queryRaw: jest.fn().mockResolvedValue([outboxRow('e1')]) });
    const { service } = makeService({ SYNC_PEER_URL: PEER, SYNC_HMAC_SECRET: 's3cret' }, admin);
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => 'down' });

    await expect(service.runOutboundSync()).resolves.toEqual({ sent: 0, failed: 1 });
    const sql = sqlOf(admin.$executeRaw.mock.calls[0]);
    expect(sql).toContain('retry_count = retry_count + 1');
    expect(sql).not.toContain('failed_at');
  });

  it('ağ hatası (fetch throw) = transient: retry sayacı artar, dead-letter yok', async () => {
    const admin = makeAdmin({ $queryRaw: jest.fn().mockResolvedValue([outboxRow('e1')]) });
    const { service } = makeService({ SYNC_PEER_URL: PEER, SYNC_HMAC_SECRET: 's3cret' }, admin);
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.runOutboundSync()).resolves.toEqual({ sent: 0, failed: 1 });
    const sql = sqlOf(admin.$executeRaw.mock.calls[0]);
    expect(sql).toContain('retry_count = retry_count + 1');
    expect(sql).not.toContain('failed_at');
    // last_error network mesajını taşır (parametre olarak).
    expect(admin.$executeRaw.mock.calls[0].slice(1).join(' ')).toContain('network: ECONNREFUSED');
  });

  it('kısmi başarı: peer`ın reddettiği event retry`a düşer (MAX_RETRY`da failed_at), kalanlar synced', async () => {
    const admin = makeAdmin({
      $queryRaw: jest.fn().mockResolvedValue([outboxRow('ok1'), outboxRow('bad1')]),
    });
    const { service } = makeService({ SYNC_PEER_URL: PEER, SYNC_HMAC_SECRET: 's3cret' }, admin);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ applied: 1, failed: [{ eventId: 'bad1', error: 'apply error' }] }),
    });

    await expect(service.runOutboundSync()).resolves.toEqual({ sent: 1, failed: 1 });

    const sqls = admin.$executeRaw.mock.calls.map(sqlOf);
    const syncedSql = sqls.find((s) => s.includes('synced_at = NOW()'));
    const failedSql = sqls.find((s) => s.includes('retry_count = retry_count + 1'));
    expect(syncedSql).toBeDefined();
    // Per-event apply hatası MAX_RETRY eşiğine bağlı dead-letter CASE'i taşır
    // (transport yolundan farklı olarak failed_at burada VAR).
    expect(failedSql).toContain('failed_at');
    // synced UPDATE yalnız başarılı id'yi alır.
    const syncedCall = admin.$executeRaw.mock.calls[sqls.indexOf(syncedSql!)];
    expect(syncedCall[1]).toEqual(['ok1']);
  });

  it('pruneDormantOutbox: peer yapılandırılmışsa no-op (satırlar teslim bekliyor)', async () => {
    const admin = makeAdmin();
    const { service } = makeService({ SYNC_PEER_URL: PEER, SYNC_HMAC_SECRET: 's3cret' }, admin);
    await expect(service.pruneDormantOutbox()).resolves.toBe(0);
    expect(admin.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('pruneDormantOutbox: peer yoksa yaş-bazlı siler ve silinen sayıyı döner (#934)', async () => {
    const admin = makeAdmin({ $executeRawUnsafe: jest.fn().mockResolvedValue(42) });
    const { service } = makeService({}, admin);
    await expect(service.pruneDormantOutbox(30)).resolves.toBe(42);
    const [sql, arg] = admin.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('synced_at IS NULL');
    expect(arg).toBe('30');
  });
});
