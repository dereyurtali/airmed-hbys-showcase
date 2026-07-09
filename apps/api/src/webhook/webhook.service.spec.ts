import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContextService } from '../tenant/tenant-context.service';
import { assertPublicWebhookUrl } from './ssrf-guard';
import { WebhookService, signPayload } from './webhook.service';

// #938 — WebhookService dispatch + delivery davranış testi. Kilitlenen kurallar:
// emit yalnız aktif + event-abone webhook'lara delivery üretir, deliver HMAC
// imzalı POST atar, başarısızlıkta retry planına girer, 5. denemede dead_letter,
// pasif webhook'a asla POST atılmaz, SSRF guard delivery ÖNCESİ koşar.

// SSRF guard gerçek DNS çözümü yapar → unit'te modül mock'u.
jest.mock('./ssrf-guard', () => ({ assertPublicWebhookUrl: jest.fn() }));
const ssrfMock = assertPublicWebhookUrl as jest.Mock;

const TENANT = '11111111-1111-1111-1111-111111111111';
const MANAGER = { id: 'mgr', roles: ['yonetici'] as const };
const RECEPTION = { id: 'rec', roles: ['resepsiyon'] as const };
const SECRET = 'a'.repeat(64);

function makeService(scoped: Record<string, Record<string, jest.Mock>>) {
  const prisma = { scoped } as unknown as PrismaService;
  const tenantContext = { requireTenantId: () => TENANT } as unknown as TenantContextService;
  return new WebhookService(prisma, tenantContext);
}

function deliveryRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'd1',
    tenantId: TENANT,
    event: 'appointment.created',
    payload: { appointmentId: 'app-1' },
    status: 'pending',
    attemptCount: 0,
    webhook: { id: 'w1', url: 'https://hooks.example.com/x', secret: SECRET, isActive: true },
    ...over,
  };
}

describe('WebhookService (#938)', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    ssrfMock.mockReset().mockResolvedValue(undefined);
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  describe('emit', () => {
    it('yalnız aktif + event`e abone webhook`lara pending delivery üretir', async () => {
      const findMany = jest.fn().mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);
      const createMany = jest.fn().mockResolvedValue({ count: 2 });
      const service = makeService({
        webhook: { findMany },
        webhookDelivery: { createMany },
      });
      const count = await service.emit('appointment.created' as never, { appointmentId: 'a1' });
      expect(count).toBe(2);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, events: { has: 'appointment.created' } },
        }),
      );
      const rows = createMany.mock.calls[0][0].data;
      expect(rows.map((r: { webhookId: string }) => r.webhookId)).toEqual(['w1', 'w2']);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].tenantId).toBe(TENANT);
    });

    it('abone webhook yoksa 0 döner, delivery yazılmaz', async () => {
      const createMany = jest.fn();
      const service = makeService({
        webhook: { findMany: jest.fn().mockResolvedValue([]) },
        webhookDelivery: { createMany },
      });
      await expect(service.emit('patient.created' as never, {})).resolves.toBe(0);
      expect(createMany).not.toHaveBeenCalled();
    });
  });

  describe('deliver', () => {
    it('2xx cevap → delivered + HMAC imza header`ı gövdeden hesaplanır', async () => {
      const update = jest.fn().mockResolvedValue({});
      const service = makeService({
        webhookDelivery: { findFirst: jest.fn().mockResolvedValue(deliveryRow()), update },
      });
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

      const result = await service.deliver('d1');
      expect(result).toEqual(
        expect.objectContaining({ ok: true, status: 'delivered', responseStatus: 200 }),
      );

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://hooks.example.com/x');
      // İmza gerçekten gönderilen body üzerinden doğrulanabilir olmalı.
      expect(init.headers['X-Webhook-Signature']).toBe(`sha256=${signPayload(SECRET, init.body)}`);
      expect(init.headers['X-Webhook-Event']).toBe('appointment.created');
      expect(init.headers['X-Webhook-Delivery']).toBe('d1');

      const data = update.mock.calls[0][0].data;
      expect(data.status).toBe('delivered');
      expect(data.attemptCount).toBe(1);
      expect(data.nextRetryAt).toBeNull();
    });

    it('non-2xx cevap → failed + retry planına göre nextRetryAt ileri tarihli', async () => {
      const update = jest.fn().mockResolvedValue({});
      const service = makeService({
        webhookDelivery: { findFirst: jest.fn().mockResolvedValue(deliveryRow()), update },
      });
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });

      const result = await service.deliver('d1');
      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');

      const data = update.mock.calls[0][0].data;
      expect(data.status).toBe('failed');
      expect(data.attemptCount).toBe(1);
      expect(data.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('5. deneme de başarısız → dead_letter, artık denenmez (nextRetryAt null)', async () => {
      const update = jest.fn().mockResolvedValue({});
      const service = makeService({
        webhookDelivery: {
          findFirst: jest
            .fn()
            .mockResolvedValue(deliveryRow({ status: 'failed', attemptCount: 4 })),
          update,
        },
      });
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });

      const result = await service.deliver('d1');
      expect(result.status).toBe('dead_letter');
      const data = update.mock.calls[0][0].data;
      expect(data.status).toBe('dead_letter');
      expect(data.attemptCount).toBe(5);
      expect(data.nextRetryAt).toBeNull();
    });

    it('pasif webhook → POST atılmadan dead_letter', async () => {
      const update = jest.fn().mockResolvedValue({});
      const row = deliveryRow();
      (row.webhook as { isActive: boolean }).isActive = false;
      const service = makeService({
        webhookDelivery: { findFirst: jest.fn().mockResolvedValue(row), update },
      });
      const result = await service.deliver('d1');
      expect(result).toEqual({ ok: false, status: 'dead_letter', error: 'Webhook deactivated' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('zaten delivered → idempotent erken dönüş, ne POST ne update', async () => {
      const update = jest.fn();
      const service = makeService({
        webhookDelivery: {
          findFirst: jest.fn().mockResolvedValue(deliveryRow({ status: 'delivered' })),
          update,
        },
      });
      await expect(service.deliver('d1')).resolves.toEqual({ ok: true, status: 'delivered' });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('SSRF guard reddederse POST hiç atılmaz → failed + retry (#937)', async () => {
      ssrfMock.mockRejectedValue(new Error('private IP blocked'));
      const update = jest.fn().mockResolvedValue({});
      const service = makeService({
        webhookDelivery: { findFirst: jest.fn().mockResolvedValue(deliveryRow()), update },
      });
      const result = await service.deliver('d1');
      expect(result.status).toBe('failed');
      expect(result.error).toContain('private IP blocked');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('delivery yoksa → NotFound', async () => {
      const service = makeService({
        webhookDelivery: { findFirst: jest.fn().mockResolvedValue(null) },
      });
      await expect(service.deliver('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('admin CRUD kapısı', () => {
    it('create: yönetici olmayan rol → Forbidden', async () => {
      const create = jest.fn();
      const service = makeService({ webhook: { create } });
      await expect(
        service.create({ name: 'n', url: 'https://x', events: [] } as never, RECEPTION),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(create).not.toHaveBeenCalled();
    });

    it('create: secret otomatik üretilir (64 hex) ve kayda yazılır', async () => {
      const create = jest.fn(async ({ data }) => ({ id: 'w1', ...data }));
      const service = makeService({ webhook: { create } });
      await service.create(
        { name: 'n', url: 'https://hooks.example.com/x', events: ['patient.created'] } as never,
        MANAGER,
      );
      const data = create.mock.calls[0][0].data;
      expect(data.secret).toMatch(/^[0-9a-f]{64}$/);
      expect(data.tenantId).toBe(TENANT);
      expect(data.createdById).toBe('mgr');
    });
  });
});
