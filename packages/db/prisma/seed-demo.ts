/**
 * Demo seed — local development only.
 *
 * Tüm klinik (5 + S12a) + platform (3) rolleri için login edilebilir demo user'lar.
 * Production seed (`seed.ts`) çalıştırıldıktan SONRA bunu çalıştır:
 *   npm run db:seed && npm run db:seed:demo
 *
 * Tüm demo şifreler: `demo12345` (bcrypt cost 12).
 * mustChangePassword=false (direkt login için).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { assertSeedAllowed } from './_seed-guard';

const prisma = new PrismaClient();

const DEMOEYE_SLUG = 'demoeye-dushanbe';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'demo12345';
const BCRYPT_COST = 12;

const CLINIC_DEMO_USERS = [
  { email: 'yonetici.demo@demoeye.tj', name: 'Cem Öztürk', role: 'yonetici' },
  {
    email: 'asistan.demo@demoeye.tj',
    name: 'Demo Yönetici Asistanı',
    role: 'yonetici_asistani',
  },
  { email: 'doktor.demo@demoeye.tj', name: 'Demo Doktor', role: 'doktor' },
  { email: 'resepsiyon.demo@demoeye.tj', name: 'Derya Şahin', role: 'resepsiyon' },
  { email: 'hemsire.demo@demoeye.tj', name: 'Demo Hemşire', role: 'hemsire' },
  {
    email: 'satis.demo@demoeye.tj',
    name: 'Burak Demir',
    role: 'ameliyat_satis',
  },
  {
    email: 'olcum.demo@demoeye.tj',
    name: 'Hülya Acar',
    role: 'olcum_hemsiresi',
  },
  // v0.4/v0.4.2 — 3 yeni rol demo kullanıcısı (boşluk kapatıldı: finans/stok/eczane
  // ekranlarını gerçek rolle test/demo edebilmek için).
  { email: 'finans.demo@demoeye.tj', name: 'Demo Finans', role: 'finans' },
  { email: 'stok.demo@demoeye.tj', name: 'Demo Stok & Satın Alma', role: 'stok_satinalma' },
  { email: 'eczane.demo@demoeye.tj', name: 'Demo Eczane', role: 'eczane' },
] as const;

const PLATFORM_DEMO_ADMINS = [
  {
    email: 'engineer.demo@dnasoft.co',
    name: 'Demo Platform Engineer',
    role: 'platform_engineer' as const,
  },
  {
    email: 'support.demo@dnasoft.co',
    name: 'Demo Platform Support',
    role: 'platform_support' as const,
  },
];

async function main() {
  assertSeedAllowed('seed-demo');
  console.warn('[seed-demo] starting…');

  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMOEYE_SLUG } });
  if (!tenant) {
    throw new Error(`Tenant '${DEMOEYE_SLUG}' bulunamadı. Önce 'npm run db:seed' çalıştır.`);
  }
  console.warn(`[seed-demo] tenant: ${tenant.slug} (${tenant.id})`);

  await prisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenant.id}'`);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);

  for (const demo of CLINIC_DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: demo.email } },
      update: {
        passwordHash,
        mustChangePassword: false,
        status: 'active',
        name: demo.name,
      },
      create: {
        tenantId: tenant.id,
        email: demo.email,
        passwordHash,
        name: demo.name,
        locale: 'tr',
        status: 'active',
        mustChangePassword: false,
      },
    });

    const role = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: tenant.id, key: demo.role } },
    });

    await prisma.userRole.upsert({
      where: {
        tenantId_userId_roleId: {
          tenantId: tenant.id,
          userId: user.id,
          roleId: role.id,
        },
      },
      update: {},
      create: { tenantId: tenant.id, userId: user.id, roleId: role.id },
    });

    console.warn(`[seed-demo] clinic user: ${demo.email} → ${demo.role}`);
  }

  // doktor.demo user'ını sample Doctor profile'ına bağla (S4+S5 doktor sıkı
  // izolasyonu: PatientDoctor zinciri Doctor.userId üzerinden çalışır; bağlama
  // yoksa doktor kendisine atanmış hastaları bile göremez).
  const doktorDemoUser = await prisma.user.findUnique({
    where: {
      tenantId_email: { tenantId: tenant.id, email: 'doktor.demo@demoeye.tj' },
    },
  });
  if (doktorDemoUser) {
    // Gerçekçi demo kimliği (realistic-test-data standardı): doktor sidebar'ı
    // kullanıcı kartında ad + uzmanlık gösterir, "Dr. Test Hekim" yerine.
    await prisma.doctor.update({
      where: { id: 'a0000000-0000-0000-0000-000000000001' },
      data: {
        userId: doktorDemoUser.id,
        name: 'Dr. Elif Kaya',
        specialty: 'Katarakt & Ön Segment',
      },
    });
    console.warn(`[seed-demo] doctor profile 'Dr. Elif Kaya' → linked to doktor.demo`);
  }

  const platformPasswordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);
  for (const demo of PLATFORM_DEMO_ADMINS) {
    const admin = await prisma.platformAdmin.upsert({
      where: { email: demo.email },
      update: { passwordHash: platformPasswordHash, name: demo.name, isActive: true },
      create: {
        email: demo.email,
        passwordHash: platformPasswordHash,
        name: demo.name,
        role: demo.role,
        isActive: true,
      },
    });
    console.warn(`[seed-demo] platform admin: ${admin.email} → ${demo.role}`);
  }

  // Localhost'tan /platform/* erişimi için CIDR allowlist (idempotent).
  const localhostCidrs = [
    { cidr: '127.0.0.1/32', label: 'demo-localhost-ipv4' },
    { cidr: '::1/128', label: 'demo-localhost-ipv6' },
  ];
  for (const entry of localhostCidrs) {
    const existing = await prisma.platformAdminIpAllowlist.findFirst({
      where: { cidr: entry.cidr, label: entry.label },
    });
    if (!existing) {
      await prisma.platformAdminIpAllowlist.create({
        data: { cidr: entry.cidr, label: entry.label, isActive: true },
      });
      console.warn(`[seed-demo] platform allowlist: ${entry.cidr} (${entry.label})`);
    }
  }

  console.warn('[seed-demo] done ✓');
  console.warn('');
  console.warn('Demo credentials (all passwords: demo12345):');
  console.warn('  Klinik (login: http://localhost:5173):');
  for (const u of CLINIC_DEMO_USERS) {
    console.warn(`    ${u.role.padEnd(20)} ${u.email}`);
  }
  console.warn('  Platform (login: http://localhost:5174):');
  for (const u of PLATFORM_DEMO_ADMINS) {
    console.warn(`    ${u.role.padEnd(20)} ${u.email}`);
  }
  console.warn(`    platform_owner       ali@dnasoft.co`);
  console.warn(`    platform_owner       owner@dnasoft.co`);
  console.warn(`    (owner password from seed.ts: platform-owner-dev-pass)`);
}

main()
  .catch((err) => {
    console.error('[seed-demo] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
