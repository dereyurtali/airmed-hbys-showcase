import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NotificationService } from '../../notification/notification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { DiscountApprovalService } from './approval.service';

// R5 (#727) — "Eskale et" service testi. Asistan bekleyen indirim onayını onay
// yetkili yöneticilere (yonetici + finans) bildirim ile iletir; kendini hariç
// tutar; bekleyen değilse 400; onay yoksa 404.

const APPROVAL_ID = '99999999-9999-9999-9999-999999999999';
const ASSISTANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('DiscountApprovalService.escalate', () => {
  let service: DiscountApprovalService;
  let scoped: {
    discountApproval: { findFirst: jest.Mock };
    user: { findMany: jest.Mock };
  };
  let notifications: { createForUsers: jest.Mock };

  beforeEach(async () => {
    scoped = {
      discountApproval: { findFirst: jest.fn() },
      user: { findMany: jest.fn() },
    };
    notifications = { createForUsers: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DiscountApprovalService,
        { provide: PrismaService, useValue: { scoped } },
        { provide: TenantContextService, useValue: { requireTenantId: () => 't1' } },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(DiscountApprovalService);
  });

  it('bekleyen onayı yöneticilere iletir + asistanın kendisini hariç tutar', async () => {
    scoped.discountApproval.findFirst.mockResolvedValue({
      id: APPROVAL_ID,
      status: 'pending',
      discountPercent: new Prisma.Decimal('15'),
      surgeryId: null,
      invoiceId: 'inv-1',
    });
    // Asistan aynı zamanda 'yonetici' rolü taşısa bile kendine bildirim gitmez.
    scoped.user.findMany.mockResolvedValue([{ id: 'mgr-1' }, { id: ASSISTANT }, { id: 'fin-1' }]);

    const res = await service.escalate(APPROVAL_ID, {
      id: ASSISTANT,
      roles: ['yonetici_asistani'],
    });

    expect(res).toEqual({ notified: 2 });
    expect(notifications.createForUsers).toHaveBeenCalledWith(
      ['mgr-1', 'fin-1'],
      expect.objectContaining({ type: 'approval_escalated' }),
    );
  });

  it('bekleyen değilse 400 (already approved → eskale edilemez)', async () => {
    scoped.discountApproval.findFirst.mockResolvedValue({
      id: APPROVAL_ID,
      status: 'approved',
      discountPercent: new Prisma.Decimal('15'),
      surgeryId: null,
      invoiceId: 'inv-1',
    });

    await expect(
      service.escalate(APPROVAL_ID, { id: ASSISTANT, roles: ['yonetici_asistani'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(notifications.createForUsers).not.toHaveBeenCalled();
  });

  it('onay kaydı yoksa 404', async () => {
    scoped.discountApproval.findFirst.mockResolvedValue(null);

    await expect(
      service.escalate(APPROVAL_ID, { id: ASSISTANT, roles: ['yonetici_asistani'] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
