/* eslint-disable no-console */
//
// Realistic operational seed — demoeye-dushanbe tenant için gerçek görünümlü
// hasta/doktor/randevu/muayene/ölçüm/cerrahi verisi. Demo ekranlarının dolu
// görünmesi için. Idempotent: deterministik UUID'ler + upsert kullanır.
//
// Detaylı standartlar: ~/.claude/projects/.../memory/feedback_realistic_test_data.md
//
import { PrismaClient } from '@prisma/client';
import type {
  AppointmentStatus,
  AppointmentType,
  AnesthesiaType,
  EyeSide,
  Gender,
  LeadSource,
  MeasurementType,
  SurgeonRole,
  SurgeryStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { assertSeedAllowed } from './_seed-guard';

const prisma = new PrismaClient();
const TENANT_SLUG = 'demoeye-dushanbe';

// ─── deterministic UUID (idempotent seed) ────────────────────────────────────
function did(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  // v4-ish format; not RFC 4122 but valid uuid for Postgres
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ─── Verhoeff (S13 MRN check digit) ─────────────────────────────────────────
const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
function verhoeff(input: string): number {
  const arr = input.split('').map(Number).reverse();
  let c = 0;
  arr.forEach((n, i) => {
    c = VD[c][VP[(i + 1) % 8][n]];
  });
  return INV[c];
}
function makeMrn(prefix: string, year: number, seq: number): string {
  const yy = (year % 100).toString().padStart(2, '0');
  const seqStr = seq.toString().padStart(5, '0');
  return `${prefix}${yy}${verhoeff(yy + seqStr)}${seqStr}`;
}

// ─── Patient pool — Tacik / Türk / Rus karışımı, gerçekçi yaş dağılımı ──────
type PatientSeed = {
  first: string;
  last: string;
  gender: Gender;
  birth: string; // YYYY-MM-DD
  phone: string;
  lead: LeadSource;
  notes?: string;
};
const PATIENTS: PatientSeed[] = [
  {
    first: 'Шарифа',
    last: 'Каримова',
    gender: 'female',
    birth: '1958-03-12',
    phone: '+992917234561',
    lead: 'doctor_referral',
    notes: 'Bilateral senile cataract',
  },
  {
    first: 'Бахром',
    last: 'Назаров',
    gender: 'male',
    birth: '1965-08-20',
    phone: '+992918111223',
    lead: 'whatsapp',
  },
  {
    first: 'Зарина',
    last: 'Шарипова',
    gender: 'female',
    birth: '1972-11-04',
    phone: '+992919345567',
    lead: 'instagram',
  },
  {
    first: 'Фарход',
    last: 'Раджабов',
    gender: 'male',
    birth: '1948-01-30',
    phone: '+992917555789',
    lead: 'returning_patient',
    notes: 'OD glaucoma, takipte',
  },
  {
    first: 'Гулнора',
    last: 'Юсупова',
    gender: 'female',
    birth: '1955-06-15',
    phone: '+992918876234',
    lead: 'optic_partner',
  },
  {
    first: 'Сафар',
    last: 'Холов',
    gender: 'male',
    birth: '1962-09-22',
    phone: '+992917432198',
    lead: 'corporate_contract',
    notes: 'Şirket sağlık anlaşması',
  },
  {
    first: 'Мехринисо',
    last: 'Махмудова',
    gender: 'female',
    birth: '1980-04-18',
    phone: '+992919812765',
    lead: 'telegram',
  },
  {
    first: 'Ҷамшед',
    last: 'Сафаров',
    gender: 'male',
    birth: '1991-12-03',
    phone: '+992918998112',
    lead: 'walk_in',
    notes: 'Yüksek miyop, kontrol',
  },
  {
    first: 'Дилноза',
    last: 'Қодирова',
    gender: 'female',
    birth: '1976-07-11',
    phone: '+992917221334',
    lead: 'whatsapp',
  },
  {
    first: 'Ӯктам',
    last: 'Ғаниев',
    gender: 'male',
    birth: '1945-05-08',
    phone: '+992918334556',
    lead: 'doctor_referral',
    notes: 'Yaşa bağlı maküla dejenerasyonu',
  },
  {
    first: 'Ayşe',
    last: 'Yıldız',
    gender: 'female',
    birth: '1968-02-28',
    phone: '+992917889112',
    lead: 'returning_patient',
  },
  {
    first: 'Mehmet',
    last: 'Demir',
    gender: 'male',
    birth: '1952-10-14',
    phone: '+992918445667',
    lead: 'doctor_referral',
    notes: 'Bilateral pseudophakia adayı',
  },
  {
    first: 'Fatma',
    last: 'Koç',
    gender: 'female',
    birth: '1989-03-25',
    phone: '+992919556778',
    lead: 'instagram',
  },
  {
    first: 'Hasan',
    last: 'Aydın',
    gender: 'male',
    birth: '1971-08-09',
    phone: '+992917667889',
    lead: 'walk_in',
  },
  {
    first: 'Емине',
    last: 'Ali',
    gender: 'female',
    birth: '1995-06-21',
    phone: '+992918778990',
    lead: 'telegram',
    notes: 'Refraksiyon kontrolu',
  },
  {
    first: 'Елена',
    last: 'Петрова',
    gender: 'female',
    birth: '1963-04-17',
    phone: '+992917890123',
    lead: 'optic_partner',
  },
  {
    first: 'Игорь',
    last: 'Соколов',
    gender: 'male',
    birth: '1957-11-29',
    phone: '+992918901234',
    lead: 'returning_patient',
    notes: 'Diabetik retinopati',
  },
  {
    first: 'Ольга',
    last: 'Иванова',
    gender: 'female',
    birth: '1981-09-05',
    phone: '+992919012345',
    lead: 'whatsapp',
  },
  {
    first: 'Сергей',
    last: 'Кузнецов',
    gender: 'male',
    birth: '1974-12-12',
    phone: '+992917123456',
    lead: 'field_rep',
  },
  {
    first: 'Анна',
    last: 'Морозова',
    gender: 'female',
    birth: '2005-08-19',
    phone: '+992918234567',
    lead: 'walk_in',
    notes: 'Strabismus, pediatrik',
  },
  {
    first: 'Парвина',
    last: 'Олимова',
    gender: 'female',
    birth: '1969-01-23',
    phone: '+992917345678',
    lead: 'doctor_referral',
  },
  {
    first: 'Носир',
    last: 'Рашидов',
    gender: 'male',
    birth: '1953-06-04',
    phone: '+992918456789',
    lead: 'returning_patient',
    notes: 'Glokom, periyodik takip',
  },
  {
    first: 'Мунира',
    last: 'Тураева',
    gender: 'female',
    birth: '1985-10-30',
    phone: '+992919567890',
    lead: 'instagram',
  },
  {
    first: 'Хуршед',
    last: 'Юнусов',
    gender: 'male',
    birth: '1942-03-07',
    phone: '+992917678901',
    lead: 'doctor_referral',
    notes: 'OS olgun katarakt',
  },
  {
    first: 'Шахло',
    last: 'Исматова',
    gender: 'female',
    birth: '1958-09-16',
    phone: '+992918789012',
    lead: 'corporate_contract',
  },
  {
    first: 'Алиджон',
    last: 'Раҳмонов',
    gender: 'male',
    birth: '1966-07-22',
    phone: '+992919890123',
    lead: 'whatsapp',
    notes: 'Premium IOL talep',
  },
  {
    first: 'Зулфия',
    last: 'Каримова',
    gender: 'female',
    birth: '1990-11-08',
    phone: '+992917901234',
    lead: 'telegram',
  },
  {
    first: 'Лазиз',
    last: 'Назаров',
    gender: 'male',
    birth: '1979-02-14',
    phone: '+992918012345',
    lead: 'walk_in',
  },
  {
    first: 'Малика',
    last: 'Шарифова',
    gender: 'female',
    birth: '2010-05-26',
    phone: '+992919123456',
    lead: 'walk_in',
    notes: 'Çocuk, refraktif kontrol',
  },
  {
    first: 'Рустам',
    last: 'Икромов',
    gender: 'male',
    birth: '1959-12-31',
    phone: '+992917234567',
    lead: 'returning_patient',
  },
];

// ─── Doctor pool — 4 doktor (2 user-bound, 2 profile-only) ──────────────────
type DoctorSeed = {
  key: string;
  name: string;
  specialty: string;
  type: 'local' | 'visiting' | 'referral';
  email?: string; // varsa User'a bağlanır
  commissionRate: number;
  phone: string;
};
const DOCTORS: DoctorSeed[] = [
  {
    key: 'rakhimov',
    name: 'Dr. Anvar Rakhimov',
    specialty: 'Ön Segment / Katarakt',
    type: 'local',
    email: 'doktor.demo@demoeye.tj',
    commissionRate: 30,
    phone: '+992917000001',
  },
  {
    key: 'said',
    name: 'Dr. Diana Said',
    specialty: 'Retina / Vitreus',
    type: 'local',
    commissionRate: 30,
    phone: '+992918000002',
  },
  {
    key: 'yildiz',
    name: 'Prof. Dr. İsmail Yıldız (visiting, İstanbul)',
    specialty: 'Refraktif Cerrahi',
    type: 'visiting',
    commissionRate: 50,
    phone: '+90 532 100 22 33',
  },
  {
    key: 'saidov',
    name: 'Dr. Khurshed Saidov (referral, regional clinic)',
    specialty: 'Genel Oftalmoloji',
    type: 'referral',
    commissionRate: 10,
    phone: '+992918999111',
  },
];

// ─── helpers ─────────────────────────────────────────────────────────────────
function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
function atTime(base: Date, hh: number, mm: number): Date {
  const d = new Date(base);
  d.setHours(hh, mm, 0, 0);
  return d;
}
function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}
function phoneLast4(phone: string): string {
  return phone.replace(/\D/g, '').slice(-4);
}

// ─── 1) Doctors + availability ───────────────────────────────────────────────
async function seedDoctors(tenantId: string) {
  // Not: tüm doktorlar Doctor tablosunda profile-only (userId=null).
  // Examination.doctorId User tablosuna bağlandığı için bu yeterli;
  // ayrıca doktor.demo User zaten seed-demo'da legacy "Dr. Test Hekim" Doctor
  // kaydına bağlandı, biz onunla çakışmıyoruz.
  const created: { seed: DoctorSeed; doctorId: string }[] = [];
  for (const d of DOCTORS) {
    const doctorId = did(`doctor:${tenantId}:${d.key}`);
    await prisma.doctor.upsert({
      where: { id: doctorId },
      update: {
        name: d.name,
        specialty: d.specialty,
        type: d.type,
        commissionRate: d.commissionRate,
        contactPhone: d.phone,
        isActive: true,
      },
      create: {
        id: doctorId,
        tenantId,
        name: d.name,
        specialty: d.specialty,
        type: d.type,
        commissionRate: d.commissionRate,
        contactPhone: d.phone,
        isActive: true,
      },
    });
    created.push({ seed: d, doctorId });
  }
  return created;
}

async function seedAvailability(
  tenantId: string,
  doctors: { seed: DoctorSeed; doctorId: string }[],
) {
  for (const { seed, doctorId } of doctors) {
    if (seed.type === 'visiting' || seed.type === 'referral') continue; // ziyaretçi/referral takvim yok
    for (const dow of [1, 2, 3, 4, 5]) {
      const avId = did(`availability:${doctorId}:${dow}`);
      await prisma.doctorAvailability.upsert({
        where: { id: avId },
        update: { startTime: '09:00', endTime: '17:00', isActive: true },
        create: {
          id: avId,
          tenantId,
          doctorId,
          dayOfWeek: dow,
          startTime: '09:00',
          endTime: '17:00',
        },
      });
    }
  }
}

// ─── 2) Patients ─────────────────────────────────────────────────────────────
async function seedPatients(tenantId: string) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { mrnPrefix: 'TD' } }); // S13
  const records: { seed: PatientSeed; id: string; mrn: string }[] = [];
  let seq = 1;
  // #388 — gerçekçi demo: bazı hastalara alerji/antikoagülan ki worklist güvenlik
  // rozeti boş kalmasın. Deterministik dağılım (idx bazlı; ~yarısında veri var).
  const ALLERGY_POOL = [
    [],
    ['Penisilin'],
    [],
    ['Sülfonamid'],
    ['Lateks'],
    [],
    ['Penisilin', 'Aspirin'],
  ];
  for (const p of PATIENTS) {
    const idx = records.length;
    const id = did(`patient:${tenantId}:${p.first}-${p.last}-${p.birth}`);
    const mrn = makeMrn('TD', 2026, seq++);
    const allergies = ALLERGY_POOL[idx % ALLERGY_POOL.length];
    const anticoagulantMedications =
      idx % 4 === 0 ? ['Varfarin'] : idx % 6 === 0 ? ['Asetilsalisilik asit'] : [];
    await prisma.patient.upsert({
      where: { id },
      update: {
        firstName: p.first,
        lastName: p.last,
        phone: p.phone,
        phoneLast4: phoneLast4(p.phone),
        leadSource: p.lead,
        notes: p.notes,
        allergies,
        anticoagulantMedications,
      },
      create: {
        id,
        tenantId,
        mrn,
        firstName: p.first,
        lastName: p.last,
        birthDate: new Date(p.birth),
        gender: p.gender,
        phone: p.phone,
        phoneLast4: phoneLast4(p.phone),
        leadSource: p.lead,
        leadSourceNote: null,
        notes: p.notes ?? null,
        allergies,
        anticoagulantMedications,
      },
    });
    records.push({ seed: p, id, mrn });
  }

  // MRN counter sync — sıradaki UI create'i çakışmasın. seq son hasta için
  // ++ ile arttı, yani şu an seq = PATIENTS.length + 1; last_seq = seq - 1.
  const lastSeq = seq - 1;
  await prisma.$executeRaw`
    INSERT INTO "mrn_counters" ("tenant_id", "year", "last_seq")
    VALUES (${tenantId}::uuid, 2026, ${lastSeq})
    ON CONFLICT ("tenant_id", "year")
    DO UPDATE SET "last_seq" = GREATEST("mrn_counters"."last_seq", ${lastSeq})
  `;

  return records;
}

// ─── 3) Appointments — past 4 wk + today + next 2 wk, mixed statuses ─────────
type ApptRecord = {
  id: string;
  patientId: string;
  doctorId: string;
  status: AppointmentStatus;
  startsAt: Date;
  type: AppointmentType;
};
async function seedAppointments(
  tenantId: string,
  doctors: { seed: DoctorSeed; doctorId: string }[],
  patients: { seed: PatientSeed; id: string; mrn: string }[],
): Promise<ApptRecord[]> {
  const localDoctors = doctors.filter((d) => d.seed.type === 'local');
  const records: ApptRecord[] = [];
  let seq = 0;

  // Geçmiş 4 hafta: completed (büyük çoğunluk) + bazı no_show/cancelled
  for (let day = 28; day >= 1; day--) {
    const base = daysAgo(day);
    const wd = base.getDay();
    if (wd === 0 || wd === 6) continue; // hafta sonu yok
    const slotsPerDay = 4 + (seq % 3); // 4-6 randevu/gün
    for (let s = 0; s < slotsPerDay; s++) {
      const patient = pick(patients, seq);
      const doctor = pick(localDoctors, seq);
      const hh = 9 + s * 2;
      const startsAt = atTime(base, hh, 0);
      const endsAt = atTime(base, hh, 30);
      const r = seq % 10;
      const status: AppointmentStatus = r < 8 ? 'completed' : r === 8 ? 'no_show' : 'cancelled';
      const type: AppointmentType = r === 0 ? 'control' : r === 1 ? 'examination' : 'consultation';
      const id = did(`appt:${tenantId}:${seq}:past`);
      await prisma.appointment.upsert({
        where: { id },
        update: { status, startsAt, endsAt },
        create: {
          id,
          tenantId,
          patientId: patient.id,
          doctorId: doctor.doctorId,
          type,
          status,
          startsAt,
          endsAt,
        },
      });
      records.push({
        id,
        patientId: patient.id,
        doctorId: doctor.doctorId,
        status,
        startsAt,
        type,
      });
      seq++;
    }
  }

  // Bugün — checked_in / in_progress / scheduled karışımı
  const today = daysAgo(0);
  for (let s = 0; s < 6; s++) {
    const patient = pick(patients, seq);
    const doctor = pick(localDoctors, seq);
    const hh = 9 + s * 2;
    const startsAt = atTime(today, hh, 0);
    const endsAt = atTime(today, hh, 30);
    const r = seq % 6;
    const status: AppointmentStatus = r < 2 ? 'checked_in' : r < 3 ? 'in_progress' : 'scheduled';
    const id = did(`appt:${tenantId}:${seq}:today`);
    await prisma.appointment.upsert({
      where: { id },
      update: { status, startsAt, endsAt },
      create: {
        id,
        tenantId,
        patientId: patient.id,
        doctorId: doctor.doctorId,
        type: 'consultation',
        status,
        startsAt,
        endsAt,
      },
    });
    records.push({
      id,
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status,
      startsAt,
      type: 'consultation',
    });
    seq++;
  }

  // Sonraki 2 hafta — scheduled
  for (let day = 1; day <= 14; day++) {
    const base = daysAgo(-day);
    const wd = base.getDay();
    if (wd === 0 || wd === 6) continue;
    const slots = 3 + (day % 2);
    for (let s = 0; s < slots; s++) {
      const patient = pick(patients, seq);
      const doctor = pick(localDoctors, seq);
      const hh = 9 + s * 2;
      const startsAt = atTime(base, hh, 0);
      const endsAt = atTime(base, hh, 30);
      const type: AppointmentType = seq % 5 === 0 ? 'surgery' : 'consultation';
      const id = did(`appt:${tenantId}:${seq}:future`);
      await prisma.appointment.upsert({
        where: { id },
        update: { startsAt, endsAt, type },
        create: {
          id,
          tenantId,
          patientId: patient.id,
          doctorId: doctor.doctorId,
          type,
          status: 'scheduled',
          startsAt,
          endsAt,
        },
      });
      records.push({
        id,
        patientId: patient.id,
        doctorId: doctor.doctorId,
        status: 'scheduled',
        startsAt,
        type,
      });
      seq++;
    }
  }
  return records;
}

// ─── 4) Examinations — tamamlanan randevuların %75'i için ────────────────────
const ICD10_EYE = [
  'H25.13 - Senile katarakt, bilateral',
  'H40.11 - POAG, hafif',
  'H35.31 - Yaş tipi maküla dejenerasyonu',
  'H52.13 - Miyop',
  'H50.04 - Esoforia',
  'H10.9 - Konjunktivit',
  'H02.43 - Pitozis, sağ',
  'H43.31 - Vitröz dejenerasyonu',
];
async function seedExaminations(
  tenantId: string,
  appts: ApptRecord[],
  patients: { seed: PatientSeed; id: string; mrn: string }[],
) {
  // appointment.doctorId Doctor tablosuna referans; Examination.doctorId User tablosuna.
  // Demo doktor user (doktor.demo) ile examinations ürettirilecek.
  const examinerUser = await prisma.user.findUniqueOrThrow({
    where: { tenantId_email: { tenantId, email: 'doktor.demo@demoeye.tj' } },
  });
  let seq = 0;
  for (const ap of appts) {
    if (ap.status !== 'completed') continue;
    if (seq % 4 === 0) {
      seq++;
      continue;
    } // %75 oran
    const id = did(`exam:${ap.id}`);
    const dx = pick(ICD10_EYE, seq);
    const patient = patients.find((p) => p.id === ap.patientId)!;
    const age = 2026 - new Date(patient.seed.birth).getFullYear();
    await prisma.examination.upsert({
      where: { id },
      update: { diagnosis: dx },
      create: {
        id,
        tenantId,
        patientId: ap.patientId,
        doctorId: examinerUser.id,
        appointmentId: ap.id,
        chiefComplaint: [
          'Görmede azalma',
          'Göz yorgunluğu',
          'Periferik görme kaybı',
          'Yakını görememe',
          'Bulanık görme',
        ][seq % 5],
        history: `${age} yaş, son 3 ay içinde şikayetler kötüleşmiş. Sistemik: HT, DM yok.`,
        // #388 — kanonik ExaminationFindings şekli (odVa/osVa/anteriorSegment/
        // fundus); eski OD/OS/anterior_segment şekli hiçbir yerde okunmuyordu.
        findings: {
          odVa: '20/40',
          osVa: '20/60',
          anteriorSegment: 'Açık açı, lens hafif opak (OS)',
          fundus: 'Normal fundus',
        },
        diagnosis: dx,
        treatmentPlan:
          seq % 3 === 0
            ? 'Katarakt cerrahisi planı; OS önce'
            : seq % 3 === 1
              ? 'Damla tedavisi + 3 ay kontrol'
              : 'Refraksiyon değişimi, gözlük reçetesi',
        prescription: seq % 3 === 1 ? 'Latanoprost %0.005 1×1 (akşam OD)' : null,
        examinedAt: ap.startsAt,
      },
    });
    seq++;
  }
}

// ─── 5) Measurements — VA, IOP, refraction karışımı ──────────────────────────
async function seedMeasurements(
  tenantId: string,
  patients: { seed: PatientSeed; id: string; mrn: string }[],
) {
  const examinerUser = await prisma.user.findUniqueOrThrow({
    where: { tenantId_email: { tenantId, email: 'doktor.demo@demoeye.tj' } },
  });
  let seq = 0;
  for (const p of patients) {
    // Her hastaya 1-3 ölçüm
    const count = 1 + (seq % 3);
    for (let i = 0; i < count; i++) {
      const day = 30 - ((seq * 7 + i * 3) % 60);
      const measuredAt = daysAgo(day);
      const types: MeasurementType[] = [
        'visual_acuity',
        'intraocular_pressure',
        'refraction',
        'biometry',
        'keratometry',
      ];
      const type = types[(seq + i) % types.length];
      const values: Record<string, unknown> = (() => {
        switch (type) {
          case 'visual_acuity':
            return {
              OD: ['20/20', '20/30', '20/40', '20/60', '20/100'][(seq + i) % 5],
              OS: ['20/20', '20/40', '20/50', '20/80'][(seq + i) % 4],
            };
          case 'intraocular_pressure':
            return { OD: 12 + ((seq + i) % 8), OS: 14 + ((seq + i) % 6), unit: 'mmHg' };
          case 'refraction':
            return {
              OD: { sphere: -1.5 - i * 0.25, cylinder: -0.5, axis: 90 },
              OS: { sphere: -1.75, cylinder: -0.75, axis: 85 },
            };
          case 'biometry':
            return { OD: { axialLength: 23.4 + i * 0.05, ACD: 3.2, K1: 43.5, K2: 44.1 } };
          case 'keratometry':
            return { OD: { K1: 43.5, K2: 44.0, axis1: 90, axis2: 180 } };
          default:
            return {};
        }
      })();
      const id = did(`meas:${p.id}:${i}:${type}`);
      await prisma.measurement.upsert({
        where: { id },
        update: { values: values as never, measuredAt },
        create: {
          id,
          tenantId,
          patientId: p.id,
          type,
          values: values as never,
          measuredAt,
          measuredById: examinerUser.id,
        },
      });
    }
    seq++;
  }
}

// ─── 6) Surgeries — geçmişte ~10 ameliyat, B1 alanları dolu ──────────────────
async function seedSurgeries(
  tenantId: string,
  doctors: { seed: DoctorSeed; doctorId: string }[],
  patients: { seed: PatientSeed; id: string; mrn: string }[],
) {
  // Sadece yaşı 50+ olan hastalar için katarakt cerrahisi
  const candidates = patients
    .filter((p) => 2026 - new Date(p.seed.birth).getFullYear() >= 50)
    .slice(0, 10);
  const localDoctors = doctors.filter((d) => d.seed.type === 'local');
  const visitingDoc = doctors.find((d) => d.seed.type === 'visiting');
  let seq = 0;
  for (const p of candidates) {
    const day = 60 - seq * 5; // son 3 ay
    const scheduledAt = daysAgo(day);
    const performedAt = day > 0 ? daysAgo(day) : null;
    const status: SurgeryStatus = day > 0 ? 'performed' : 'planned';
    const useVisiting = seq % 4 === 0 && visitingDoc;
    const doctor = useVisiting ? visitingDoc! : pick(localDoctors, seq);
    const surgeonRole: SurgeonRole = useVisiting ? 'VISITING' : 'LOCAL';
    const eyeSide: EyeSide = (seq % 2 === 0 ? 'od' : 'os') as EyeSide;
    const anesthesia: AnesthesiaType = (seq % 3 === 0 ? 'topical' : 'periocular') as AnesthesiaType;
    const complication = seq === 3 || seq === 7;
    const id = did(`surgery:${p.id}:${seq}`);
    await prisma.surgery.upsert({
      where: { id },
      update: { status, performedAt },
      create: {
        id,
        tenantId,
        patientId: p.id,
        doctorId: doctor.doctorId,
        type: 'Phacoemulsification + IOL',
        status,
        scheduledAt,
        performedAt,
        eyeSide,
        anesthesiaType: anesthesia,
        surgeonRole,
        complicationFlag: complication,
        complicationNotes: complication
          ? 'Posterior kapsül rüptürü, vitröz prolapsus yok, anterior vitrektomi yapıldı'
          : null,
        complicationDetail: complication
          ? { category: 'PCR', severity: 'moderate', description: 'PC rupture intra-op' }
          : undefined,
        preOp: {
          va_OD: '20/200',
          va_OS: '20/40',
          iop_OD: 15,
          iop_OS: 14,
          axialLength_OD: 23.5,
          iolPowerSelected: 21.5,
        },
        intraOp: {
          incision: '2.4mm temporal clear corneal',
          capsulorhexis: '5.5mm',
          phacoTime: '1:42',
          irrigation: '120ml',
        },
        postOp: { iolPosition: 'in-the-bag', wound: 'Self-sealing', plan: '1g/1h/1ay/3ay kontrol' },
      },
    });
    seq++;
  }
}

// ─── 7) S15 — IolModel + Lot + SurgicalKit (S15-PR21/PR25) ──────────────────
async function seedIolStockAndKits(tenantId: string) {
  // 3 IOL modeli — kitler bunlara referans verir
  const models = [
    {
      key: 'monofocal',
      brand: 'Alcon',
      model: 'SN60WF Monofocal',
      desc: 'Standart monofocal hidrofobik akrilik',
    },
    {
      key: 'trifocal',
      brand: 'Alcon',
      model: 'PanOptix Trifocal',
      desc: 'Premium trifocal (yakın + orta + uzak)',
    },
    {
      key: 'toric',
      brand: 'Johnson & Johnson',
      model: 'Tecnis Toric',
      desc: 'Astigmat düzeltme + monofocal',
    },
  ];
  const created: { key: string; id: string }[] = [];
  for (const m of models) {
    const id = did(`iol-model:${tenantId}:${m.key}`);
    await prisma.iolModel.upsert({
      where: { id },
      update: { isActive: true },
      create: {
        id,
        tenantId,
        brand: m.brand,
        model: m.model,
        description: m.desc,
        isActive: true,
      },
    });
    created.push({ key: m.key, id });
  }

  // Her model için 2 lot (farklı power) — S15-PR21 3-state fields
  const lots: { key: string; modelKey: string; id: string }[] = [];
  for (const m of created) {
    for (let i = 0; i < 2; i++) {
      const power = 20 + i * 1.5;
      const lotKey = `${m.key}-lot${i + 1}`;
      const id = did(`iol-lot:${tenantId}:${lotKey}`);
      const initialQty = 8 - i * 2; // ilk lot 8 adet, ikinci 6
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 2);
      await prisma.iolLot.upsert({
        where: { id },
        update: {},
        create: {
          id,
          tenantId,
          modelId: m.id,
          lotNumber: `LOT-${m.key.toUpperCase()}-${2026}-${i + 1}`,
          power,
          quantity: initialQty,
          availableQty: initialQty,
          reservedQty: 0,
          consumedQty: 0,
          version: 0,
          expiresAt,
          supplier: 'DemoEye Supplier Ltd.',
        },
      });
      lots.push({ key: lotKey, modelKey: m.key, id });
    }
  }

  // S15-PR25 — 3 surgical kit (cerrahi sarf reçetesi)
  const kits = [
    {
      key: 'phaco-standard',
      code: 'PHACO-STD',
      name: 'Phaco Standart Paket (Monofocal)',
      surgeryType: 'Phacoemulsification + IOL',
      components: [
        { modelKey: 'monofocal', qty: 1, required: true, name: null },
        { modelKey: null, qty: 1, required: true, name: 'Phaco kartuş seti' },
        { modelKey: null, qty: 1, required: true, name: 'Viscoelastic (Healon 1ml)' },
        { modelKey: null, qty: 1, required: false, name: 'Steril drape + örtüler' },
      ],
    },
    {
      key: 'phaco-trifocal',
      code: 'PHACO-TRI',
      name: 'Phaco Trifocal Paket (Premium)',
      surgeryType: 'Phacoemulsification + Trifocal IOL',
      components: [
        { modelKey: 'trifocal', qty: 1, required: true, name: null },
        { modelKey: null, qty: 1, required: true, name: 'Phaco kartuş seti' },
        { modelKey: null, qty: 2, required: true, name: 'Premium viscoelastic (Healon GV)' },
        { modelKey: null, qty: 1, required: true, name: 'Capsular tension ring' },
      ],
    },
    {
      key: 'phaco-toric',
      code: 'PHACO-TOR',
      name: 'Phaco Toric Paket (Astigmat)',
      surgeryType: 'Phacoemulsification + Toric IOL',
      components: [
        { modelKey: 'toric', qty: 1, required: true, name: null },
        { modelKey: null, qty: 1, required: true, name: 'Phaco kartuş seti' },
        { modelKey: null, qty: 1, required: true, name: 'Toric marker (pre-op)' },
        { modelKey: null, qty: 1, required: false, name: 'Viscoelastic (Healon 1ml)' },
      ],
    },
  ];

  for (const k of kits) {
    const kitId = did(`surgical-kit:${tenantId}:${k.key}`);
    await prisma.surgicalKit.upsert({
      where: { id: kitId },
      update: { isActive: true, name: k.name },
      create: {
        id: kitId,
        tenantId,
        code: k.code,
        name: k.name,
        surgeryType: k.surgeryType,
        isActive: true,
      },
    });
    // Komponentleri yeniden oluştur (delete + recreate, idempotent için)
    await prisma.surgicalKitComponent.deleteMany({ where: { kitId } });
    for (let i = 0; i < k.components.length; i++) {
      const c = k.components[i];
      const cid = did(`surgical-kit-comp:${kitId}:${i}`);
      const iolModelId = c.modelKey
        ? (created.find((m) => m.key === c.modelKey)?.id ?? null)
        : null;
      await prisma.surgicalKitComponent.create({
        data: {
          id: cid,
          tenantId,
          kitId,
          iolModelId,
          componentName: c.name,
          quantity: c.qty,
          isRequired: c.required,
        },
      });
    }
  }

  return { models: created, lots, kits };
}

// ─── 8) S15-P3 — LabAbnormalThreshold seed (oftalmoloji eşikleri) ───────────
async function seedLabThresholds(tenantId: string) {
  // Yaygın oftalmoloji + sistemik lab eşikleri (DeepSeek qwen referansı +
  // genel TUS bilgisi). isActive=true; klinik bu satırları override edebilir.
  const thresholds = [
    {
      key: 'hba1c-adult',
      testCode: 'HBA1C',
      sex: 'any' as const,
      ageMin: 18,
      ageMax: 120,
      lowLimit: '4.0',
      highLimit: '6.5',
      unit: '%',
      notes: 'Diyabet eşiği — >6.5 oftalmoloji cerrahisi risk',
    },
    {
      key: 'crp-adult',
      testCode: 'CRP',
      sex: 'any' as const,
      ageMin: 18,
      ageMax: 120,
      lowLimit: null,
      highLimit: '5.0',
      unit: 'mg/L',
      notes: 'Pre-op enflamasyon belirteci — >5 araştır',
    },
    {
      key: 'axial-length-adult',
      testCode: 'AXIAL_LENGTH',
      sex: 'any' as const,
      ageMin: 18,
      ageMax: 120,
      lowLimit: '20.0',
      highLimit: '26.0',
      unit: 'mm',
      notes: 'IOL hesabı için kritik — <20 veya >26 nadir, dikkat',
    },
    {
      key: 'iop-adult',
      testCode: 'IOP',
      sex: 'any' as const,
      ageMin: 18,
      ageMax: 120,
      lowLimit: '10.0',
      highLimit: '21.0',
      unit: 'mmHg',
      notes: 'Göz içi basıncı — >21 glokom araştır',
    },
    {
      key: 'retina-thickness',
      testCode: 'RETINA_THICKNESS_OCT',
      sex: 'any' as const,
      ageMin: 18,
      ageMax: 120,
      lowLimit: '200.0',
      highLimit: '300.0',
      unit: 'μm',
      notes: 'OCT makula kalınlığı — >300 ödem şüphesi',
    },
    {
      key: 'glucose-fasting',
      testCode: 'GLUCOSE_FASTING',
      sex: 'any' as const,
      ageMin: 18,
      ageMax: 120,
      lowLimit: '70.0',
      highLimit: '110.0',
      unit: 'mg/dL',
      notes: 'Açlık glikozu — pre-op standart',
    },
  ];

  for (const t of thresholds) {
    const id = did(`lab-threshold:${tenantId}:${t.key}`);
    await prisma.labAbnormalThreshold.upsert({
      where: { id },
      update: { isActive: true },
      create: {
        id,
        tenantId,
        testCode: t.testCode,
        sex: t.sex,
        ageMin: t.ageMin,
        ageMax: t.ageMax,
        lowLimit: t.lowLimit,
        highLimit: t.highLimit,
        unit: t.unit,
        notes: t.notes,
        isActive: true,
      },
    });
  }

  return thresholds.length;
}

// ─── main ────────────────────────────────────────────────────────────────────
// #362 — Cerrahi katalog ServiceItem'a taşındı (eski statik lib/surgery-catalog.ts
// yerine). Satış faturası gerçek serviceItemId ile kesilir → S12c önce-öde sorgusu
// (category='surgery') cerrahi satışı görür; lens tipi metadata zinciriyle okunur.
const SURGERY_SERVICE_ITEMS: Array<{
  code: string;
  name: string;
  nameRu: string;
  nameTg: string;
  price: string;
  group: string;
  lens: string | null;
  materials: string[];
}> = [
  {
    code: 'OP_CAT_MONO',
    name: 'Katarakt — Monofokal Lens',
    nameRu: 'Катаракта — монофокальная линза',
    nameTg: 'Катаракта — линзаи монофокалӣ',
    price: '18000',
    group: 'Katarakt',
    lens: 'Monofokal',
    materials: ['Monofokal GİL ×1', 'Viskoelastik ×1', 'BSS Solüsyon ×1', 'Keratom Bıçağı ×1'],
  },
  {
    code: 'OP_CAT_TRI',
    name: 'Katarakt — Trifokal Lens',
    nameRu: 'Катаракта — трифокальная линза',
    nameTg: 'Катаракта — линзаи трифокалӣ',
    price: '42000',
    group: 'Katarakt',
    lens: 'Trifokal',
    materials: ['Trifokal GİL ×1', 'Viskoelastik ×1', 'BSS Solüsyon ×1', 'Keratom Bıçağı ×1'],
  },
  {
    code: 'OP_CAT_EDOF',
    name: 'Katarakt — EDOF Lens',
    nameRu: 'Катаракта — линза EDOF',
    nameTg: 'Катаракта — линзаи EDOF',
    price: '36000',
    group: 'Katarakt',
    lens: 'EDOF',
    materials: ['EDOF GİL ×1', 'Viskoelastik ×1', 'BSS Solüsyon ×1', 'Keratom Bıçağı ×1'],
  },
  {
    code: 'OP_LASIK',
    name: 'LASIK / Excimer (iki göz)',
    nameRu: 'LASIK / Excimer (оба глаза)',
    nameTg: 'LASIK / Excimer (ҳар ду чашм)',
    price: '35000',
    group: 'Refraktif',
    lens: null,
    materials: ['Keratom Bıçağı ×2', 'BSS Solüsyon ×1'],
  },
  {
    code: 'OP_TRABEKULEKTOMI',
    name: 'Trabekülektomi',
    nameRu: 'Трабекулэктомия',
    nameTg: 'Трабекулэктомия',
    price: '28000',
    group: 'Glokom',
    lens: null,
    materials: ['Viskoelastik ×1', 'Mitomisin-C ×1'],
  },
  {
    code: 'OP_IVT',
    name: 'İntravitreal Enjeksiyon (Anti-VEGF)',
    nameRu: 'Интравитреальная инъекция (Anti-VEGF)',
    nameTg: 'Тазриқи интравитреалӣ (Anti-VEGF)',
    price: '9500',
    group: 'Retina',
    lens: null,
    materials: ['Anti-VEGF Flakon ×1'],
  },
  {
    code: 'OP_PRP',
    name: 'PRP Argon Lazer',
    nameRu: 'ПРП аргоновый лазер',
    nameTg: 'PRP лазери аргон',
    price: '6000',
    group: 'Retina',
    lens: null,
    materials: [],
  },
  {
    code: 'OP_PTERYGIUM',
    name: 'Pterjium Ameliyatı',
    nameRu: 'Операция птеригиума',
    nameTg: 'Ҷарроҳии птеригиум',
    price: '12000',
    group: 'Ön Segment',
    lens: null,
    materials: ['Viskoelastik ×1', 'Keratom Bıçağı ×1'],
  },
];

async function seedSurgeryServiceItems(tenantId: string) {
  let sort = 0;
  for (const it of SURGERY_SERVICE_ITEMS) {
    sort += 1;
    const metadata = { surgeryGroup: it.group, lens: it.lens, materials: it.materials };
    await prisma.serviceItem.upsert({
      where: { tenantId_code: { tenantId, code: it.code } },
      update: {
        name: it.name,
        nameRu: it.nameRu,
        nameTg: it.nameTg,
        defaultPrice: it.price,
        defaultCurrency: 'TJS',
        category: 'surgery',
        sortOrder: sort,
        isActive: true,
        deletedAt: null,
        metadata,
      },
      create: {
        tenantId,
        code: it.code,
        name: it.name,
        nameRu: it.nameRu,
        nameTg: it.nameTg,
        category: 'surgery',
        defaultPrice: it.price,
        defaultCurrency: 'TJS',
        sortOrder: sort,
        metadata,
      },
    });
  }
}

async function main() {
  assertSeedAllowed('seed-realistic');
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });
  console.warn(`[seed-realistic] tenant: ${tenant.slug} (${tenant.id})`);

  await seedSurgeryServiceItems(tenant.id);
  console.warn(`[seed-realistic] surgery service items: ${SURGERY_SERVICE_ITEMS.length}`);

  const doctors = await seedDoctors(tenant.id);
  console.warn(`[seed-realistic] doctors: ${doctors.length}`);

  await seedAvailability(tenant.id, doctors);
  console.warn(
    `[seed-realistic] availability: 5 weekdays for ${doctors.filter((d) => d.seed.type === 'local').length} local doctors`,
  );

  const patients = await seedPatients(tenant.id);
  console.warn(
    `[seed-realistic] patients: ${patients.length} (MRN: ${patients[0].mrn} ... ${patients[patients.length - 1].mrn})`,
  );

  const appts = await seedAppointments(tenant.id, doctors, patients);
  console.warn(`[seed-realistic] appointments: ${appts.length} (past 4wk + today + next 2wk)`);

  await seedExaminations(tenant.id, appts, patients);
  console.warn(`[seed-realistic] examinations: linked to ~75% of completed appts`);

  await seedMeasurements(tenant.id, patients);
  console.warn(`[seed-realistic] measurements: 1-3 per patient`);

  await seedSurgeries(tenant.id, doctors, patients);
  console.warn(
    `[seed-realistic] surgeries: 10 (cataract, B1 fields populated, 2 with complications)`,
  );

  // S15 seed (IOL model + lot + kit + lab threshold) ayrı script:
  // `npm run db:seed:s15` çağrılır. Burada duplicate yapılmıyor (dev-up.sh
  // sırası: realistic → s15).

  console.warn('[seed-realistic] done ✓');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
