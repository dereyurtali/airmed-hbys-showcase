import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PlatformRole } from '@airmed/db';
import type { AdminPrismaService } from '../../prisma/admin-prisma.service';
import type { PlatformAuditService } from '../audit/platform-audit.service';
import { PlatformFeedbackService } from './platform-feedback.service';

// #1057 regresyonu: cross-tenant okuma artık tenant-başına runWithTenant tx
// döngüsü DEĞİL, RLS-bypass AdminPrismaService ile TEK sorgu (maliyet tenant
// sayısından bağımsız). Bu testler sorgu sayısını ve şekli kilitler.

function mockAudit() {
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as PlatformAuditService;
}

function actor(role: PlatformRole) {
  return { id: 'admin-1', email: 'a@dna', role };
}

function feedbackRow(id: string, iso: string, status = 'submitted') {
  return {
    id,
    kind: 'improvement',
    status,
    title: 'T',
    description: 'D',
    routePath: '/x',
    appVersion: '0.4.2',
    githubIssueNo: null,
    shippedVersion: null,
    createdAt: new Date(iso),
    submittedBy: { email: `${id}@x` },
    tenant: { id: 't1', name: 'A', slug: 'a' },
  };
}

function mockAdminPrisma(overrides?: {
  findMany?: jest.Mock;
  count?: jest.Mock;
  findUnique?: jest.Mock;
  update?: jest.Mock;
}) {
  const feedbackRequest = {
    findMany: overrides?.findMany ?? jest.fn().mockResolvedValue([]),
    count: overrides?.count ?? jest.fn().mockResolvedValue(0),
    findUnique: overrides?.findUnique ?? jest.fn().mockResolvedValue(null),
    update: overrides?.update ?? jest.fn(),
  };
  return { admin: { feedbackRequest } as unknown as AdminPrismaService, feedbackRequest };
}

describe('PlatformFeedbackService', () => {
  it('list: TEK findMany — filtreler where`e, sıralama/limit DB`de (#1057)', async () => {
    const rows = [
      feedbackRow('f2', '2026-06-28T12:00:00Z'),
      feedbackRow('f1', '2026-06-28T10:00:00Z'),
    ];
    const { admin, feedbackRequest } = mockAdminPrisma({
      findMany: jest.fn().mockResolvedValue(rows),
    });
    const service = new PlatformFeedbackService(admin, mockAudit());

    const result = await service.list({ status: 'submitted', kind: 'bug' });

    expect(feedbackRequest.findMany).toHaveBeenCalledTimes(1);
    expect(feedbackRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'submitted', kind: 'bug' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
    expect(result.map((r) => r.id)).toEqual(['f2', 'f1']);
  });

  it('list: tenantId filtresi where.tenantId olur', async () => {
    const { admin, feedbackRequest } = mockAdminPrisma();
    const service = new PlatformFeedbackService(admin, mockAudit());

    await service.list({ tenantId: 't1' });

    expect(feedbackRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1' } }),
    );
  });

  it('unreadCount: TEK count sorgusu (#882 + #1057)', async () => {
    const { admin, feedbackRequest } = mockAdminPrisma({
      count: jest.fn().mockResolvedValue(5),
    });
    const service = new PlatformFeedbackService(admin, mockAudit());

    const result = await service.unreadCount();

    expect(result).toEqual({ count: 5 });
    expect(feedbackRequest.count).toHaveBeenCalledTimes(1);
    expect(feedbackRequest.count).toHaveBeenCalledWith({ where: { status: 'submitted' } });
  });

  describe('updateStatus (#951 triyaj)', () => {
    it('support rolü → ForbiddenException (salt-okur)', async () => {
      const { admin, feedbackRequest } = mockAdminPrisma();
      const audit = mockAudit();
      const service = new PlatformFeedbackService(admin, audit);

      await expect(
        service.updateStatus('f1', { status: 'in_progress' }, actor('platform_support'), {
          ip: null,
          userAgent: null,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(feedbackRequest.findUnique).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('owner → günceller + audit tenantId ile yazılır', async () => {
      const updated = {
        ...feedbackRow('f1', '2026-06-28T10:00:00Z', 'in_progress'),
        githubIssueNo: 951,
        tenant: { id: 't2', name: 'B', slug: 'b' },
      };
      const { admin, feedbackRequest } = mockAdminPrisma({
        findUnique: jest.fn().mockResolvedValue({ id: 'f1', tenantId: 't2' }),
        update: jest.fn().mockResolvedValue(updated),
      });
      const audit = mockAudit();
      const service = new PlatformFeedbackService(admin, audit);

      const result = await service.updateStatus(
        'f1',
        { status: 'in_progress', githubIssueNo: 951 },
        actor('platform_owner'),
        { ip: '10.0.0.1', userAgent: 'jest' },
      );

      expect(feedbackRequest.update).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('in_progress');
      expect(result.githubIssueNo).toBe(951);
      expect(result.tenant).toEqual({ id: 't2', name: 'B', slug: 'b' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'feedback.triage',
          entityType: 'feedback_request',
          entityId: 'f1',
          payload: expect.objectContaining({ tenantId: 't2' }),
        }),
      );
    });

    it('kayıt yoksa → NotFoundException, update çağrılmaz', async () => {
      const { admin, feedbackRequest } = mockAdminPrisma();
      const audit = mockAudit();
      const service = new PlatformFeedbackService(admin, audit);

      await expect(
        service.updateStatus('f1', { status: 'shipped' }, actor('platform_engineer'), {
          ip: null,
          userAgent: null,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(feedbackRequest.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
