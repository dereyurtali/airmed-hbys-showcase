import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEFAULT_CLINIC_ROLES, ensureClinicRoles } from '../src/seed-helpers';
import { assertSeedAllowed } from './_seed-guard';

const prisma = new PrismaClient();

const DEMOEYE_SLUG = 'demoeye-dushanbe';
const ADMIN_EMAIL = 'admin@demoeye.tj';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';
const E2E_EMAIL = 'e2e@demoeye.tj';
const E2E_PASSWORD = process.env.SEED_E2E_PASSWORD ?? 'e2e-test-pass';
const BCRYPT_COST = 12;

const PLATFORM_OWNER_PASSWORD =
  process.env.SEED_PLATFORM_OWNER_PASSWORD ?? 'platform-owner-dev-pass';
const PLATFORM_OWNERS: { email: string; name: string }[] = [
  { email: 'ali@dnasoft.co', name: 'Ali DEREYURT' },
  { email: 'owner@dnasoft.co', name: 'Platform Owner' },
];

// Dev-only allowlist: when DEV_PLATFORM_OPEN_IPS=true, seed `0.0.0.0/0` so
// localhost + dev tunnels can reach /platform/*. Production seeds will be
// replaced manually with real office/VPN CIDRs (F2 ops runbook, post-pilot).
const DEV_PLATFORM_OPEN_IPS = process.env.DEV_PLATFORM_OPEN_IPS === 'true';

async function main() {
  assertSeedAllowed('seed');
  console.warn('[seed] starting…');

  // ---------------------------------------------------------------------------
  // 1. DemoEye Clinic tenant
  // ---------------------------------------------------------------------------
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEMOEYE_SLUG },
    update: { mrnPrefix: 'TD' },
    create: {
      slug: DEMOEYE_SLUG,
      name: 'DemoEye Clinic',
      status: 'active',
      plan: 'pilot',
      locale: 'tr',
      timezone: 'Asia/Dushanbe',
      mrnPrefix: 'TD',
    },
  });
  console.warn(`[seed] tenant: ${tenant.slug} (${tenant.id})`);

  // RLS active on tenant tables — set tenant context so subsequent inserts pass.
  await prisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenant.id}'`);

  // ---------------------------------------------------------------------------
  // 2. Roles — paylaşılan DEFAULT_CLINIC_ROLES (admin-bootstrap CLI ile aynı kaynak)
  // ---------------------------------------------------------------------------
  await ensureClinicRoles(prisma, tenant.id);
  console.warn(`[seed] roles: ${DEFAULT_CLINIC_ROLES.length} (v0.4 — tümü aktif)`);

  // ---------------------------------------------------------------------------
  // 3. Admin user (yonetici)
  // ---------------------------------------------------------------------------
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_COST);
  const adminUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: ADMIN_EMAIL } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: ADMIN_EMAIL,
      passwordHash,
      name: 'DemoEye Admin',
      locale: 'tr',
      status: 'active',
      mustChangePassword: true, // first login forces change
    },
  });
  console.warn(`[seed] admin user: ${adminUser.email} (${adminUser.id})`);

  // Assign yonetici role
  const yoneticiRole = await prisma.role.findUniqueOrThrow({
    where: { tenantId_key: { tenantId: tenant.id, key: 'yonetici' } },
  });
  await prisma.userRole.upsert({
    where: {
      tenantId_userId_roleId: {
        tenantId: tenant.id,
        userId: adminUser.id,
        roleId: yoneticiRole.id,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: adminUser.id,
      roleId: yoneticiRole.id,
    },
  });
  console.warn(`[seed] admin user → yonetici role assigned`);

  // ---------------------------------------------------------------------------
  // 3b. E2E test user — Playwright fixture (mustChangePassword=false so the
  // golden-path login spec can navigate to /dashboard without an extra
  // password-change hop. Kept as `doktor` to exercise the most common role.)
  // ---------------------------------------------------------------------------
  const e2ePasswordHash = await bcrypt.hash(E2E_PASSWORD, BCRYPT_COST);
  const e2eUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: E2E_EMAIL } },
    update: { passwordHash: e2ePasswordHash, mustChangePassword: false },
    create: {
      tenantId: tenant.id,
      email: E2E_EMAIL,
      passwordHash: e2ePasswordHash,
      name: 'E2E Test User',
      locale: 'tr',
      status: 'active',
      mustChangePassword: false,
    },
  });

  const doktorRole = await prisma.role.findUniqueOrThrow({
    where: { tenantId_key: { tenantId: tenant.id, key: 'doktor' } },
  });
  await prisma.userRole.upsert({
    where: {
      tenantId_userId_roleId: {
        tenantId: tenant.id,
        userId: e2eUser.id,
        roleId: doktorRole.id,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: e2eUser.id,
      roleId: doktorRole.id,
    },
  });
  console.warn(`[seed] e2e user: ${e2eUser.email} → doktor role assigned`);

  // 3c. E2E admin user — Playwright fixture for full-access page smokes
  // (doctors/iol/leads/procedures/schedule). yonetici_asistani = tam sidebar +
  // /dashboard landing + jenerik pano; mustChangePassword=false. Doktor e2e
  // user'ı kısıtlı menü + /worklist landing'i yüzünden bu sayfalara erişemiyor.
  const e2eAdmin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'e2e-admin@demoeye.tj' } },
    update: { passwordHash: e2ePasswordHash, mustChangePassword: false },
    create: {
      tenantId: tenant.id,
      email: 'e2e-admin@demoeye.tj',
      passwordHash: e2ePasswordHash,
      name: 'E2E Admin User',
      locale: 'tr',
      status: 'active',
      mustChangePassword: false,
    },
  });
  const asistanRole = await prisma.role.findUniqueOrThrow({
    where: { tenantId_key: { tenantId: tenant.id, key: 'yonetici_asistani' } },
  });
  await prisma.userRole.upsert({
    where: {
      tenantId_userId_roleId: {
        tenantId: tenant.id,
        userId: e2eAdmin.id,
        roleId: asistanRole.id,
      },
    },
    update: {},
    create: { tenantId: tenant.id, userId: e2eAdmin.id, roleId: asistanRole.id },
  });
  console.warn(`[seed] e2e admin: ${e2eAdmin.email} → yonetici_asistani role assigned`);

  // 3d. E2E yönetici user — sadece-yönetici (branded AdminSidebar + Genel Bakış
  // AdminOverviewPage) ekranlarını test etmek için. mustChangePassword=false.
  const e2eYonetici = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'e2e-yonetici@demoeye.tj' } },
    update: { passwordHash: e2ePasswordHash, mustChangePassword: false },
    create: {
      tenantId: tenant.id,
      email: 'e2e-yonetici@demoeye.tj',
      passwordHash: e2ePasswordHash,
      name: 'E2E Yönetici',
      locale: 'tr',
      status: 'active',
      mustChangePassword: false,
    },
  });
  await prisma.userRole.upsert({
    where: {
      tenantId_userId_roleId: {
        tenantId: tenant.id,
        userId: e2eYonetici.id,
        roleId: yoneticiRole.id,
      },
    },
    update: {},
    create: { tenantId: tenant.id, userId: e2eYonetici.id, roleId: yoneticiRole.id },
  });
  console.warn(`[seed] e2e yonetici: ${e2eYonetici.email} → yonetici role assigned`);

  // ---------------------------------------------------------------------------
  // 4. Sample doctor profile + weekly availability
  // ---------------------------------------------------------------------------
  const sampleDoctor = await prisma.doctor.upsert({
    where: { id: 'a0000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: 'a0000000-0000-0000-0000-000000000001',
      tenantId: tenant.id,
      name: 'Dr. Test Hekim',
      specialty: 'Göz Hastalıkları',
      type: 'local',
      contactEmail: 'doktor@demoeye.tj',
      isActive: true,
    },
  });
  console.warn(`[seed] doctor: ${sampleDoctor.name} (${sampleDoctor.id})`);

  // Weekly availability: Mon-Fri 09:00-17:00 (dayOfWeek 1..5)
  for (let day = 1; day <= 5; day++) {
    await prisma.doctorAvailability.upsert({
      where: { id: `b0000000-0000-0000-0000-00000000000${day}` },
      update: {},
      create: {
        id: `b0000000-0000-0000-0000-00000000000${day}`,
        tenantId: tenant.id,
        doctorId: sampleDoctor.id,
        dayOfWeek: day,
        startTime: '09:00',
        endTime: '17:00',
        isActive: true,
      },
    });
  }
  console.warn(`[seed] doctor availability: Mon-Fri 09:00-17:00`);

  // Sample test patient (idempotent, deterministic UUID). Playwright e2e
  // ("Randevu oluştur" deep-link, slot click → AppointmentDialog patient picker)
  // bu hastayı arar; perf seed'iyle karışmasın diye `mrn` prefix `TEST` (perf
  // seed'in `PERF` prefix'inden farklı).
  const testPatient = await prisma.patient.upsert({
    where: { id: 'c0000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: 'c0000000-0000-0000-0000-000000000001',
      tenantId: tenant.id,
      mrn: 'TEST00001',
      firstName: 'Ayşe',
      lastName: 'Test Hasta',
      birthDate: new Date('1985-03-15'),
      gender: 'female',
      phone: '+992111000123',
      phoneLast4: '0123',
    },
  });
  console.warn(
    `[seed] test patient: ${testPatient.firstName} ${testPatient.lastName} (${testPatient.mrn})`,
  );

  // ---------------------------------------------------------------------------
  // 5. F2 — Platform admins (DNA team) + dev IP allowlist
  // ---------------------------------------------------------------------------
  for (const owner of PLATFORM_OWNERS) {
    const platformPasswordHash = await bcrypt.hash(PLATFORM_OWNER_PASSWORD, BCRYPT_COST);
    const admin = await prisma.platformAdmin.upsert({
      where: { email: owner.email },
      update: {},
      create: {
        email: owner.email,
        passwordHash: platformPasswordHash,
        name: owner.name,
        role: 'platform_owner',
        isActive: true,
      },
    });
    console.warn(`[seed] platform admin: ${admin.email} (platform_owner)`);
  }

  if (DEV_PLATFORM_OPEN_IPS) {
    const existing = await prisma.platformAdminIpAllowlist.findFirst({
      where: { cidr: '0.0.0.0/0', label: 'dev-open-allow-all' },
    });
    if (!existing) {
      await prisma.platformAdminIpAllowlist.create({
        data: { cidr: '0.0.0.0/0', label: 'dev-open-allow-all', isActive: true },
      });
    }
    console.warn(`[seed] platform allowlist: 0.0.0.0/0 (DEV ONLY — replace in prod)`);
  } else {
    console.warn(`[seed] platform allowlist: SKIPPED (set DEV_PLATFORM_OPEN_IPS=true to enable)`);
  }

  console.warn('[seed] done ✓');
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
