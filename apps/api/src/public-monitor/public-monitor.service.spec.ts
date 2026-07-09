import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AdminPrismaService } from '../prisma/admin-prisma.service';
import { PublicMonitorService } from './public-monitor.service';

const VALID_KEY = 'wm_' + 'a'.repeat(64);
const KEY_HASH = createHash('sha256').update(VALID_KEY).digest('hex');
const TENANT_ID = '11111111-1111-1111-1111-111111111111';

describe('PublicMonitorService', () => {
  let admin: { tenant: { findUnique: jest.Mock }; encounter: { findMany: jest.Mock } };
  let service: PublicMonitorService;

  beforeEach(() => {
    admin = {
      tenant: { findUnique: jest.fn() },
      encounter: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new PublicMonitorService(admin as unknown as AdminPrismaService);
  });

  it('geçersiz format → 401 (DB sorgusu yok)', async () => {
    await expect(service.getWaitingByKey('bozuk-anahtar')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(admin.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('bilinmeyen anahtar → 401 (jenerik)', async () => {
    admin.tenant.findUnique.mockResolvedValue(null);
    await expect(service.getWaitingByKey(VALID_KEY)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(admin.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { publicMonitorKeyHash: KEY_HASH } }),
    );
  });

  it('pasif/askıda tenant → 401', async () => {
    admin.tenant.findUnique.mockResolvedValue({
      id: TENANT_ID,
      status: 'active',
      suspendedAt: new Date(),
      deletedAt: null,
    });
    await expect(service.getWaitingByKey(VALID_KEY)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('anonimleştirir (tam soyad/tags YOK) + acil>VIP>zaman sıralar + oda türü', async () => {
    admin.tenant.findUnique.mockResolvedValue({
      id: TENANT_ID,
      status: 'active',
      suspendedAt: null,
      deletedAt: null,
    });
    admin.encounter.findMany.mockResolvedValue([
      {
        id: 'n',
        stage: 'waiting_doctor',
        isUrgent: false,
        stageUpdatedAt: new Date(),
        patient: { firstName: 'Normal', lastName: 'Yılmaz', tags: [] },
        doctor: { name: 'Mehmet Yılmaz' },
      },
      {
        id: 'v',
        stage: 'in_measurement',
        isUrgent: false,
        stageUpdatedAt: new Date(),
        patient: { firstName: 'Olga', lastName: 'Petrova', tags: ['vip'] },
        doctor: null,
      },
      {
        id: 'u',
        stage: 'waiting_doctor',
        isUrgent: true,
        stageUpdatedAt: new Date(),
        patient: { firstName: 'Acil', lastName: 'Kaya', tags: [] },
        doctor: { name: 'Zeynep Kaya' },
      },
    ]);

    const { rows } = await service.getWaitingByKey(VALID_KEY);

    // Sıra: acil > VIP > kalan.
    expect(rows.map((r) => r.id)).toEqual(['u', 'v', 'n']);
    // Anonim: "Ad S." — tam soyad değil.
    expect(rows[0].displayName).toBe('Acil K.');
    expect(rows[1].displayName).toBe('Olga P.');
    // Oda türü + doktor adı.
    expect(rows[1].kind).toBe('measurement');
    expect(rows[1].doctorName).toBeNull();
    expect(rows[2].kind).toBe('doctor');
    expect(rows[2].doctorName).toBe('Mehmet Yılmaz');
    // Payload'da tam soyad / tags SIZMAZ.
    const json = JSON.stringify(rows);
    expect(json).not.toContain('Yılmaz Yılmaz');
    expect(json).not.toContain('"tags"');
    expect(json).not.toContain('vip');
  });
});
