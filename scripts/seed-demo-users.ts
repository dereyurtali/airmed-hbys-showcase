/**
 * Dev demo kullanıcıları — Ali'nin manuel UI denemesi için.
 * Tenant-A'ya doktor + yönetici asistanı + hemşire ekler, bir doktor profili
 * + availability + örnek randevu kurar. Idempotent (upsert pattern).
 *
 * Çalıştır: npx tsx scripts/seed-demo-users.ts
 *
 * Şifre (her demo kullanıcı için): "isolation-pass"
 */
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@airmed/db';
import { assertSeedAllowed } from '../packages/db/prisma/_seed-guard';

assertSeedAllowed('seed-demo-users');

const prisma = new PrismaClient();
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const PATIENT_A = '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PASSWORD = 'isolation-pass';
const BCRYPT_COST = 4;

async function ensureUser(opts: {
  id: string;
  email: string;
  name: string;
  roleKey: 'yonetici_asistani' | 'doktor' | 'hemsire' | 'ameliyat_satis';
}) {
  const hash = await bcrypt.hash(PASSWORD, BCRYPT_COST);
  const role = await prisma.role.findUniqueOrThrow({
    where: { tenantId_key: { tenantId: TENANT_A, key: opts.roleKey } },
  });
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: TENANT_A, email: opts.email } },
    update: { name: opts.name, status: 'active', passwordHash: hash },
    create: {
      id: opts.id,
      tenantId: TENANT_A,
      email: opts.email,
      passwordHash: hash,
      name: opts.name,
      status: 'active',
    },
  });
  await prisma.userRole.upsert({
    where: {
      tenantId_userId_roleId: { tenantId: TENANT_A, userId: user.id, roleId: role.id },
    },
    update: {},
    create: { tenantId: TENANT_A, userId: user.id, roleId: role.id },
  });
  return user;
}

async function main() {
  // 1. Roller — hemsire seed'de yoksa ekle (default pasif rol)
  await prisma.role.upsert({
    where: { tenantId_key: { tenantId: TENANT_A, key: 'hemsire' } },
    update: {},
    create: { tenantId: TENANT_A, key: 'hemsire', label: 'Hemşire' },
  });
  await prisma.role.upsert({
    where: { tenantId_key: { tenantId: TENANT_A, key: 'yonetici_asistani' } },
    update: {},
    create: { tenantId: TENANT_A, key: 'yonetici_asistani', label: 'Yönetici Asistanı' },
  });

  // 2. Demo kullanıcılar
  const asistan = await ensureUser({
    id: '11111111-aaaa-bbbb-cccc-dddddddddd01',
    email: 'asistan@a.tj',
    name: 'Asistan Ayşe',
    roleKey: 'yonetici_asistani',
  });
  const doktor = await ensureUser({
    id: '11111111-aaaa-bbbb-cccc-dddddddddd02',
    email: 'doktor@a.tj',
    name: 'Dr. Mehmet Demir',
    roleKey: 'doktor',
  });
  const hemsire = await ensureUser({
    id: '11111111-aaaa-bbbb-cccc-dddddddddd03',
    email: 'hemsire@a.tj',
    name: 'Hemşire Zeynep',
    roleKey: 'hemsire',
  });
  // S12a — müşteri görüşmesi sonrası: cerrahi paket fatura+tahsilatı
  const ameliyatSatis = await ensureUser({
    id: '11111111-aaaa-bbbb-cccc-dddddddddd04',
    email: 'ameliyat-satis@a.tj',
    name: 'Ameliyat Satış Fatma',
    roleKey: 'ameliyat_satis',
  });
  void ameliyatSatis;

  // 3. Doktor profili (randevu takvimi + cerrahide görünür)
  const doktorProfile = await prisma.doctor.upsert({
    where: { id: '11111111-dddd-eeee-ffff-000000000001' },
    update: { name: 'Dr. Mehmet Demir', user: { connect: { id: doktor.id } }, isActive: true },
    create: {
      id: '11111111-dddd-eeee-ffff-000000000001',
      tenant: { connect: { id: TENANT_A } },
      user: { connect: { id: doktor.id } },
      name: 'Dr. Mehmet Demir',
      specialty: 'Göz Cerrahisi',
      contactPhone: '+992900111222',
      isActive: true,
    },
  });

  // 4. Doktor müsaitlik (Pzt-Cuma 09:00-17:00). Composite unique yok, manuel sıfırla+yarat.
  await prisma.doctorAvailability.deleteMany({ where: { doctorId: doktorProfile.id } });
  for (const dow of [1, 2, 3, 4, 5]) {
    await prisma.doctorAvailability.create({
      data: {
        tenantId: TENANT_A,
        doctorId: doktorProfile.id,
        dayOfWeek: dow,
        startTime: '09:00',
        endTime: '17:00',
      },
    });
  }

  // 5. Birkaç ekstra hasta — sadece liste boş görünmesin
  const samplePatients = [
    {
      id: '11111111-aaaa-cccc-0000-000000000010',
      mrn: 'A-1000010',
      firstName: 'Bahar',
      lastName: 'Yıldız',
      birthDate: new Date('1972-04-15'),
      gender: 'female' as const,
      phone: '+992900111333',
    },
    {
      id: '11111111-aaaa-cccc-0000-000000000011',
      mrn: 'A-1000011',
      firstName: 'Cengiz',
      lastName: 'Karadeniz',
      birthDate: new Date('1968-11-02'),
      gender: 'male' as const,
      phone: '+992900111334',
    },
    {
      id: '11111111-aaaa-cccc-0000-000000000012',
      mrn: 'A-1000012',
      firstName: 'Deniz',
      lastName: 'Aksoy',
      birthDate: new Date('1985-06-28'),
      gender: 'female' as const,
      phone: '+992900111335',
    },
  ];
  for (const p of samplePatients) {
    await prisma.patient.upsert({
      where: { id: p.id },
      update: { firstName: p.firstName, lastName: p.lastName },
      create: { ...p, tenantId: TENANT_A },
    });
  }

  // 6. Bugün için iki demo randevu (resepsiyon görsün, doktor görsün)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const slot1 = new Date(today);
  slot1.setHours(10, 0, 0, 0);
  const slot1End = new Date(slot1);
  slot1End.setMinutes(30);
  const slot2 = new Date(today);
  slot2.setHours(11, 30, 0, 0);
  const slot2End = new Date(slot2);
  slot2End.setMinutes(slot2End.getMinutes() + 30);

  await prisma.appointment.upsert({
    where: { id: '11111111-aaaa-cccc-1111-000000000020' },
    update: { startsAt: slot1, endsAt: slot1End },
    create: {
      id: '11111111-aaaa-cccc-1111-000000000020',
      tenantId: TENANT_A,
      patientId: PATIENT_A,
      doctorId: doktorProfile.id,
      type: 'consultation',
      status: 'scheduled',
      startsAt: slot1,
      endsAt: slot1End,
    },
  });
  await prisma.appointment.upsert({
    where: { id: '11111111-aaaa-cccc-1111-000000000021' },
    update: { startsAt: slot2, endsAt: slot2End },
    create: {
      id: '11111111-aaaa-cccc-1111-000000000021',
      tenantId: TENANT_A,
      patientId: samplePatients[0].id,
      doctorId: doktorProfile.id,
      type: 'control',
      status: 'scheduled',
      startsAt: slot2,
      endsAt: slot2End,
    },
  });

  console.log('✓ Demo seed tamam');
  console.log('');
  console.log('Tenant: tenant-a');
  console.log('URL:    http://localhost:5173 (login için "tenant-a" slug otomatik gelir)');
  console.log('Şifre:  isolation-pass (her demo kullanıcı için)');
  console.log('');
  console.log('Kullanıcılar:');
  console.log('  admin@a.tj      — Yönetici (her şeyi görür)');
  console.log('  asistan@a.tj    — Yönetici Asistanı (user mgmt + API key dışında her şey)');
  console.log('  doktor@a.tj     — Doktor (klinik akış)');
  console.log('  reception@a.tj  — Resepsiyon (hasta + randevu)');
  console.log('  hemsire@a.tj    — Hemşire (ölçüm + check-in)');
  console.log('  ameliyat-satis@a.tj — Ameliyat Satış (cerrahi paket fatura+tahsilatı; S12a)');
  console.log('');
  console.log('Hazır veri:');
  console.log('  - 4 hasta (Ali Veli, Bahar, Cengiz, Deniz)');
  console.log('  - 1 doktor (Dr. Mehmet Demir, Pzt-Cum 09:00-17:00)');
  console.log('  - Bugün için 2 randevu (10:00 + 11:30)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
