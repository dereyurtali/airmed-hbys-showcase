import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { softDeleteExtension } from '../src/extensions/soft-delete';
import * as bcrypt from 'bcrypt';

const TENANT_SLUG = 'test-soft-delete';
const TENANT_ID = '11111111-1111-1111-1111-111111111111';

const basePrisma = new PrismaClient();
const prisma = basePrisma.$extends(softDeleteExtension);

async function setTenantContext() {
  await basePrisma.$executeRawUnsafe(`SET app.current_tenant_id = '${TENANT_ID}'`);
}

beforeAll(async () => {
  // Tenant has no RLS — create directly.
  await basePrisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: {
      id: TENANT_ID,
      slug: TENANT_SLUG,
      name: 'Soft Delete Test Tenant',
      status: 'active',
      plan: 'pilot',
    },
  });
});

beforeEach(async () => {
  await setTenantContext();
  // Clean slate — bypass extension to hard delete test rows.
  await basePrisma.patient.deleteMany({ where: { tenantId: TENANT_ID } });
});

afterAll(async () => {
  await setTenantContext();
  await basePrisma.patient.deleteMany({ where: { tenantId: TENANT_ID } });
  await basePrisma.tenant.delete({ where: { id: TENANT_ID } }).catch(() => {});
  await basePrisma.$disconnect();
});

describe('soft-delete extension', () => {
  it('delete sets deletedAt instead of removing the row', async () => {
    const patient = await basePrisma.patient.create({
      data: {
        tenantId: TENANT_ID,
        mrn: 'MRN001',
        firstName: 'Soft',
        lastName: 'Delete',
        birthDate: new Date('1990-01-01'),
        gender: 'other',
      },
    });

    await prisma.patient.delete({ where: { id: patient.id } });

    const raw = await basePrisma.patient.findUnique({ where: { id: patient.id } });
    expect(raw).not.toBeNull();
    expect(raw!.deletedAt).not.toBeNull();
  });

  it('findMany filters out soft-deleted rows by default', async () => {
    await basePrisma.patient.create({
      data: {
        tenantId: TENANT_ID,
        mrn: 'MRN002',
        firstName: 'Visible',
        lastName: 'Patient',
        birthDate: new Date('1990-01-01'),
        gender: 'female',
      },
    });
    const ghost = await basePrisma.patient.create({
      data: {
        tenantId: TENANT_ID,
        mrn: 'MRN003',
        firstName: 'Ghost',
        lastName: 'Patient',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
        deletedAt: new Date(),
      },
    });

    const visible = await prisma.patient.findMany({
      where: { tenantId: TENANT_ID },
    });

    expect(visible).toHaveLength(1);
    expect(visible[0].firstName).toBe('Visible');
    expect(visible.find((p) => p.id === ghost.id)).toBeUndefined();
  });

  it('findMany with withDeleted=true returns soft-deleted rows', async () => {
    await basePrisma.patient.create({
      data: {
        tenantId: TENANT_ID,
        mrn: 'MRN004',
        firstName: 'Active',
        lastName: 'Patient',
        birthDate: new Date('1990-01-01'),
        gender: 'female',
      },
    });
    await basePrisma.patient.create({
      data: {
        tenantId: TENANT_ID,
        mrn: 'MRN005',
        firstName: 'Deleted',
        lastName: 'Patient',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
        deletedAt: new Date(),
      },
    });

    const all = await (prisma.patient.findMany as any)({
      where: { tenantId: TENANT_ID },
      withDeleted: true,
    });

    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some((p: { firstName: string }) => p.firstName === 'Deleted')).toBe(true);
  });

  it('count respects soft-delete filter', async () => {
    await basePrisma.patient.create({
      data: {
        tenantId: TENANT_ID,
        mrn: 'MRN006',
        firstName: 'Counted',
        lastName: 'Patient',
        birthDate: new Date('1990-01-01'),
        gender: 'female',
      },
    });
    await basePrisma.patient.create({
      data: {
        tenantId: TENANT_ID,
        mrn: 'MRN007',
        firstName: 'NotCounted',
        lastName: 'Patient',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
        deletedAt: new Date(),
      },
    });

    const count = await prisma.patient.count({ where: { tenantId: TENANT_ID } });
    expect(count).toBe(1);
  });
});
