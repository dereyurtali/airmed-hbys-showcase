import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PostOpService } from './post-op.service';
import { SURGERY_REF_TAG } from './post-op.schemas';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContextService } from '../tenant/tenant-context.service';

// #938 batch 2 — PostOpService.scheduleFollowUps. Kritik invariantlar: doktor-profili
// yoksa 400 (auth ÖNCESİ — admin bypass edemez), yalnız cerrah-veya-yönetici yazar,
// aynı ameliyata tekrar 409 (idempotency), endsAt>startsAt, overlap 23P01 → 409,
// oluşturulan randevu type='control' + #surgery: tag. Prisma mock'lu.

const SURGEON = { id: 'doc-user', roles: ['doktor'] as const };
const OTHER_DOCTOR = { id: 'other', roles: ['doktor'] as const };
const ADMIN = { id: 'adm', roles: ['yonetici'] as const };

const SURGERY = (over: Record<string, unknown> = {}) => ({
  id: 'surg1',
  patientId: 'pat1',
  doctorId: 'doc1',
  doctor: { id: 'doc1', userId: 'doc-user', deletedAt: null },
  ...over,
});

function makeService(scoped: Record<string, unknown>) {
  const prisma = { scoped } as unknown as PrismaService;
  const tenantContext = { requireTenantId: () => 't1' } as unknown as TenantContextService;
  return new PostOpService(prisma, tenantContext);
}

const proposal = {
  daysFromSurgery: 7,
  startsAt: '2026-08-01T09:00:00Z',
  endsAt: '2026-08-01T09:30:00Z',
  notes: 'kontrol',
};

describe('PostOpService.scheduleFollowUps (#938 batch 2)', () => {
  it('cerrahın doktor profili yok → BadRequest (auth ÖNCESİ, admin bypass edemez)', async () => {
    const service = makeService({
      surgery: { findFirst: jest.fn().mockResolvedValue(SURGERY({ doctor: null })) },
      appointment: { count: jest.fn(), create: jest.fn() },
    });
    await expect(
      service.scheduleFollowUps({ surgeryId: 'surg1', proposals: [proposal] }, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cerrah değil + admin değil → Forbidden', async () => {
    const service = makeService({
      surgery: { findFirst: jest.fn().mockResolvedValue(SURGERY()) },
      appointment: { count: jest.fn(), create: jest.fn() },
    });
    await expect(
      service.scheduleFollowUps({ surgeryId: 'surg1', proposals: [proposal] }, OTHER_DOCTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('aynı ameliyata zaten kontrol var → Conflict (idempotency)', async () => {
    const service = makeService({
      surgery: { findFirst: jest.fn().mockResolvedValue(SURGERY()) },
      appointment: { count: jest.fn().mockResolvedValue(1), create: jest.fn() },
    });
    await expect(
      service.scheduleFollowUps({ surgeryId: 'surg1', proposals: [proposal] }, SURGEON),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('endsAt <= startsAt → BadRequest', async () => {
    const service = makeService({
      surgery: { findFirst: jest.fn().mockResolvedValue(SURGERY()) },
      appointment: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
    });
    await expect(
      service.scheduleFollowUps(
        { surgeryId: 'surg1', proposals: [{ ...proposal, endsAt: proposal.startsAt }] },
        SURGEON,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('takvim overlap (23P01) → Conflict', async () => {
    const service = makeService({
      surgery: { findFirst: jest.fn().mockResolvedValue(SURGERY()) },
      appointment: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockRejectedValue({ code: '23P01' }),
      },
    });
    await expect(
      service.scheduleFollowUps({ surgeryId: 'surg1', proposals: [proposal] }, SURGEON),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cerrah kendi ameliyatı → control randevu + #surgery: tag oluşturur', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'appt1' });
    const service = makeService({
      surgery: { findFirst: jest.fn().mockResolvedValue(SURGERY()) },
      appointment: { count: jest.fn().mockResolvedValue(0), create },
    });
    const result = await service.scheduleFollowUps(
      { surgeryId: 'surg1', proposals: [proposal] },
      SURGEON,
    );
    expect(result).toHaveLength(1);
    const data = create.mock.calls[0][0].data;
    expect(data.type).toBe('control');
    expect(data.patientId).toBe('pat1');
    expect(data.notes).toContain(`${SURGERY_REF_TAG}surg1`); // recall ayrımı için tag
  });

  it('admin başka doktorun ameliyatına kontrol planlayabilir', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'appt1' });
    const service = makeService({
      surgery: { findFirst: jest.fn().mockResolvedValue(SURGERY()) },
      appointment: { count: jest.fn().mockResolvedValue(0), create },
    });
    await service.scheduleFollowUps({ surgeryId: 'surg1', proposals: [proposal] }, ADMIN);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
