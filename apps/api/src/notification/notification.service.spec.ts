import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { SyncGateway } from '../sync/sync.gateway';
import { TenantContextService } from '../tenant/tenant-context.service';
import { NotificationService } from './notification.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_USER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOTIF_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('NotificationService', () => {
  let service: NotificationService;
  let scoped: {
    notification: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let gateway: { broadcastNotification: jest.Mock };

  beforeEach(async () => {
    scoped = {
      notification: {
        create: jest.fn(async ({ data }) => ({
          id: NOTIF_ID,
          readAt: null,
          createdAt: new Date(),
          ...data,
        })),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(async ({ data }) => ({ id: NOTIF_ID, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    gateway = { broadcastNotification: jest.fn() };

    const prisma = { scoped } as unknown as PrismaService;
    const tenantContext = {
      requireTenantId: () => TENANT_ID,
    } as unknown as TenantContextService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: SyncGateway, useValue: gateway },
      ],
    }).compile();
    service = moduleRef.get(NotificationService);
  });

  it('create insert eder VE gateway.broadcastNotification çağırır', async () => {
    await service.create({
      recipientUserId: USER_ID,
      type: 'measurement_ready',
      title: 'Ölçüm hazır',
    });
    expect(scoped.notification.create).toHaveBeenCalled();
    expect(gateway.broadcastNotification).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, recipientUserId: USER_ID }),
    );
  });

  it('broadcast düşse bile kayıt durur (best-effort)', async () => {
    gateway.broadcastNotification.mockImplementation(() => {
      throw new Error('socket down');
    });
    const result = await service.create({
      recipientUserId: USER_ID,
      type: 'sent_to_doctor',
      title: 'Hasta geldi',
    });
    expect(result.id).toBe(NOTIF_ID);
  });

  it('markRead başkasının bildiriminde NotFound atar', async () => {
    scoped.notification.findFirst.mockResolvedValue(null);
    await expect(service.markRead(NOTIF_ID, OTHER_USER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('markRead zaten okunduysa update etmez', async () => {
    scoped.notification.findFirst.mockResolvedValue({ id: NOTIF_ID, readAt: new Date() });
    await service.markRead(NOTIF_ID, USER_ID);
    expect(scoped.notification.update).not.toHaveBeenCalled();
  });

  it('markAllRead okunmamışları toplu işaretler', async () => {
    const res = await service.markAllRead(USER_ID);
    expect(res.count).toBe(2);
    expect(scoped.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipientUserId: USER_ID, readAt: null } }),
    );
  });
});
