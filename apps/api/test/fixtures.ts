import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@airmed/db';

export interface TenantFixture {
  id: string;
  slug: string;
  adminEmail: string;
  adminPassword: string;
  adminId: string;
  patientId: string;
  receptionistEmail?: string;
  receptionistPassword?: string;
  receptionistId?: string;
}

export interface IsolationFixtures {
  tenantA: TenantFixture;
  tenantB: TenantFixture;
}

const TENANT_A_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_B_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_A_ID = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN_B_ID = '22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PATIENT_A_ID = '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PATIENT_B_ID = '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const RECEPTIONIST_A_ID = '11111111-cccc-cccc-cccc-cccccccccccc';

/**
 * Migration ile seed edilen referans/katalog tabloları — testler arası KORUNUR.
 *
 * Bunlar test-üretimi veri DEĞİL: `migrate deploy` garantiler, prod'da da hep
 * vardır, hiçbir test bunları yeniden seed etmez (ör. feature-flags suite'i 10
 * default flag'in mevcut olduğunu varsayar). Truncate edilirse o suite 0 bulur.
 * Küçük + stabil liste — yeni referans tablosu nadiren ve bilinçli eklenir.
 */
const PRESERVED_REFERENCE_TABLES = ['feature_flag_definitions'];

/**
 * Tüm `public` tablolarını tek TRUNCATE ile temizler (RESTART IDENTITY CASCADE),
 * migration-seed referans tabloları (PRESERVED_REFERENCE_TABLES) hariç.
 *
 * Neden dinamik: elle yazılan tablo listesi her yeni sprint'te (S15/S16/v0.4)
 * bayatlıyordu. `tenants`'a FK ile bağlı tablolar CASCADE ile zaten siliniyordu;
 * ama tenant'a bağlı OLMAYAN global/platform tabloları (platform_admins, ...)
 * listede olmadığından leak ediyordu. Katalogdan okumak listeyi kalıcı olarak
 * güncel tutar.
 *
 * Partition çocukları (relispartition) hariç: TRUNCATE parent zaten partition'lara
 * cascade eder; çocuğu ayrıca listelemek gereksiz. `_prisma_migrations` korunur.
 */
export async function truncateAllTables(admin: PrismaClient): Promise<void> {
  const rows = await admin.$queryRaw<{ name: string }[]>`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND c.relname <> '_prisma_migrations'
  `;
  const preserve = new Set(PRESERVED_REFERENCE_TABLES);
  const tables = rows.map((r) => r.name).filter((name) => !preserve.has(name));
  if (tables.length === 0) return;
  const list = tables.map((name) => `"public"."${name}"`).join(', ');
  await admin.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function resetAndSeedFixtures(adminUrl: string): Promise<IsolationFixtures> {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await truncateAllTables(admin);

    const passwordHash = await bcrypt.hash('isolation-pass', 4);

    await admin.tenant.create({
      data: {
        id: TENANT_A_ID,
        slug: 'tenant-a',
        name: 'Tenant A',
        status: 'active',
        mrnPrefix: 'TA',
      },
    });
    await admin.tenant.create({
      data: {
        id: TENANT_B_ID,
        slug: 'tenant-b',
        name: 'Tenant B',
        status: 'active',
        mrnPrefix: 'TB',
      },
    });

    for (const tenantId of [TENANT_A_ID, TENANT_B_ID]) {
      await admin.role.createMany({
        data: [
          { tenantId, key: 'yonetici', label: 'Yönetici' },
          { tenantId, key: 'doktor', label: 'Doktor' },
          { tenantId, key: 'resepsiyon', label: 'Resepsiyon' },
        ],
      });
    }

    const yoneticiA = await admin.role.findFirstOrThrow({
      where: { tenantId: TENANT_A_ID, key: 'yonetici' },
    });
    const yoneticiB = await admin.role.findFirstOrThrow({
      where: { tenantId: TENANT_B_ID, key: 'yonetici' },
    });

    await admin.user.create({
      data: {
        id: ADMIN_A_ID,
        tenantId: TENANT_A_ID,
        email: 'admin@a.tj',
        passwordHash,
        name: 'Admin A',
        status: 'active',
        userRoles: { create: { tenantId: TENANT_A_ID, roleId: yoneticiA.id } },
      },
    });
    await admin.user.create({
      data: {
        id: ADMIN_B_ID,
        tenantId: TENANT_B_ID,
        email: 'admin@b.tj',
        passwordHash,
        name: 'Admin B',
        status: 'active',
        userRoles: { create: { tenantId: TENANT_B_ID, roleId: yoneticiB.id } },
      },
    });

    const resepsiyonA = await admin.role.findFirstOrThrow({
      where: { tenantId: TENANT_A_ID, key: 'resepsiyon' },
    });
    await admin.user.create({
      data: {
        id: RECEPTIONIST_A_ID,
        tenantId: TENANT_A_ID,
        email: 'reception@a.tj',
        passwordHash,
        name: 'Reception A',
        status: 'active',
        userRoles: { create: { tenantId: TENANT_A_ID, roleId: resepsiyonA.id } },
      },
    });

    await admin.patient.create({
      data: {
        id: PATIENT_A_ID,
        tenantId: TENANT_A_ID,
        mrn: 'A-0000001',
        firstName: 'Ali',
        lastName: 'Veli',
        birthDate: new Date('1980-01-01'),
        gender: 'male',
        phone: '+992111111111',
      },
    });
    await admin.patient.create({
      data: {
        id: PATIENT_B_ID,
        tenantId: TENANT_B_ID,
        mrn: 'B-0000001',
        firstName: 'Bahar',
        lastName: 'Yılmaz',
        birthDate: new Date('1985-05-05'),
        gender: 'female',
        phone: '+992222222222',
      },
    });

    // S12c — varsayılan hizmet kataloğu (her kategori için 1 item).
    // assertPaidSession bu kategorilere göre paid invoice arayacak.
    for (const tenantId of [TENANT_A_ID, TENANT_B_ID]) {
      await admin.serviceItem.createMany({
        data: [
          {
            tenantId,
            code: 'EXAM_DEFAULT',
            name: 'Muayene',
            category: 'examination',
            defaultPrice: '100.00',
            defaultCurrency: 'TJS',
            isActive: true,
          },
          {
            tenantId,
            code: 'LAB_DEFAULT',
            name: 'Lab',
            category: 'lab',
            defaultPrice: '50.00',
            defaultCurrency: 'TJS',
            isActive: true,
          },
          {
            tenantId,
            code: 'SURG_DEFAULT',
            name: 'Cerrahi',
            category: 'surgery',
            defaultPrice: '500.00',
            defaultCurrency: 'TJS',
            isActive: true,
          },
          // Delta audit C-1 — procedure.create artık assertPaidSession('procedure')
          // çağırıyor; test fixture'ı için default procedure service item.
          {
            tenantId,
            code: 'PROC_DEFAULT',
            name: 'Prosedür',
            category: 'procedure',
            defaultPrice: '200.00',
            defaultCurrency: 'TJS',
            isActive: true,
          },
          {
            tenantId,
            code: 'MEAS_DEFAULT',
            name: 'Ölçüm',
            category: 'measurement',
            defaultPrice: '30.00',
            defaultCurrency: 'TJS',
            isActive: true,
          },
        ],
      });
    }

    return {
      tenantA: {
        id: TENANT_A_ID,
        slug: 'tenant-a',
        receptionistEmail: 'reception@a.tj',
        receptionistPassword: 'isolation-pass',
        receptionistId: RECEPTIONIST_A_ID,
        adminEmail: 'admin@a.tj',
        adminPassword: 'isolation-pass',
        adminId: ADMIN_A_ID,
        patientId: PATIENT_A_ID,
      },
      tenantB: {
        id: TENANT_B_ID,
        slug: 'tenant-b',
        adminEmail: 'admin@b.tj',
        adminPassword: 'isolation-pass',
        adminId: ADMIN_B_ID,
        patientId: PATIENT_B_ID,
      },
    };
  } finally {
    await admin.$disconnect();
  }
}

// S12c — "önce öde sonra hizmet" sıkı engelini bypass etmek için her
// kategoride paid invoice oluşturan helper. invoice.assertPaidSession kontrolü
// bugünün başından itibaren aranır → bugüne tarihli paid invoice yeterli.
export async function seedPaidInvoiceForCategory(
  prisma: PrismaClient,
  tenantId: string,
  patientId: string,
  category: 'examination' | 'lab' | 'surgery' | 'procedure' | 'measurement' | 'other',
  createdById?: string,
): Promise<void> {
  const code =
    category === 'examination'
      ? 'EXAM_DEFAULT'
      : category === 'lab'
        ? 'LAB_DEFAULT'
        : category === 'surgery'
          ? 'SURG_DEFAULT'
          : category === 'procedure'
            ? 'PROC_DEFAULT'
            : category === 'measurement'
              ? 'MEAS_DEFAULT'
              : 'SURG_DEFAULT';
  const item = await prisma.serviceItem.findFirstOrThrow({
    where: { tenantId, code },
  });
  const seq = Date.now().toString().slice(-9);
  await prisma.invoice.create({
    data: {
      tenantId,
      invoiceNumber: `S12C-${seq}`,
      patientId,
      createdById: createdById ?? null,
      status: 'paid',
      currency: 'TJS',
      subtotal: item.defaultPrice,
      total: item.defaultPrice,
      items: {
        create: [
          {
            tenantId,
            serviceItemId: item.id,
            description: item.name,
            quantity: 1,
            unitPrice: item.defaultPrice,
            lineTotal: item.defaultPrice,
          },
        ],
      },
    },
  });
}

// #392 — markCompleted artık WHO güvenlik kontrol listesinin 3 fazının da
// tamamlanmasını ister. markCompleted'ı test eden senaryolar (laterality,
// consent, post-op schedule) için checklist'i fully-complete'e getiren helper.
// Race-safe upsert; tüm faz timestamp'lerini set eder.
export async function completeSafetyChecklist(
  prisma: PrismaClient,
  tenantId: string,
  surgeryId: string,
): Promise<void> {
  const now = new Date();
  await prisma.surgicalSafetyCheck.upsert({
    where: { surgeryId },
    create: {
      tenantId,
      surgeryId,
      items: {},
      signInCompletedAt: now,
      timeOutCompletedAt: now,
      signOutCompletedAt: now,
    },
    update: {
      signInCompletedAt: now,
      timeOutCompletedAt: now,
      signOutCompletedAt: now,
    },
  });
}
