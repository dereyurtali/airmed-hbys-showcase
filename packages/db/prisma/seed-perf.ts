// A4 hasta arama performans seed — 10.000 fake hasta üretir.
//
// Çalıştırma:
//   npm run db:seed:perf              # 10K kayıt ekler (idempotent: çift basmaz)
//   npm run db:seed:perf -- --reset   # mevcut perf kayıtlarını siler, yeniden üretir
//
// Idempotency anahtarı: mrn prefix `PERF`. Reset bunlara göre temizler.
// Faker dependency kullanmaz — deterministik PRNG ile küçük isim havuzlarından
// kombinasyon üretir. Search testi için index kullanımı önemli, mutlak çeşitlilik
// değil; 100 × 100 havuz 10K kayıt için yeterli (ortalama 1 kişi başına 100 kayıt
// aynı first name'e düşer, gerçekçi tıklama dağılımı).
//
// Not: RLS aktif. Seed `app.current_tenant_id` set ediyor; üretim/dev DB'sinde
// DemoEye Clinic tenant'ı varsayılır (seed.ts'in ürettiği), yoksa hata fırlatır.

import { PrismaClient } from '@prisma/client';
import { assertSeedAllowed } from './_seed-guard';

const prisma = new PrismaClient();

const DEMOEYE_SLUG = 'demoeye-dushanbe';
const PERF_MRN_PREFIX = 'PERF';
const TARGET_COUNT = 10_000;
const BATCH_SIZE = 500;

// 100 first name × 100 last name = 10K kombinasyon; aynı isim 1 kez bile gelse
// "ali" araması ~100 kayıt döndürür, search behavior gerçekçi.
const FIRST_NAMES = [
  'Ali',
  'Ayşe',
  'Mehmet',
  'Fatma',
  'Ahmet',
  'Emine',
  'Mustafa',
  'Hatice',
  'Hüseyin',
  'Zeynep',
  'İbrahim',
  'Elif',
  'Yusuf',
  'Meryem',
  'Hasan',
  'Sevim',
  'Osman',
  'Hülya',
  'Ömer',
  'Sema',
  'Ramazan',
  'Aslı',
  'Murat',
  'Gül',
  'Salih',
  'Nihan',
  'Selim',
  'Pınar',
  'Bilal',
  'Esra',
  'Aleksandr',
  'Olga',
  'Dmitri',
  'Natalya',
  'Sergey',
  'Tatyana',
  'Ivan',
  'Anna',
  'Mikhail',
  'Elena',
  'Vladimir',
  'Maria',
  'Andrey',
  'Svetlana',
  'Pavel',
  'Irina',
  'Nikolay',
  'Marina',
  'Aleksey',
  'Galina',
  'Boris',
  'Ekaterina',
  'Yuri',
  'Valentina',
  'Igor',
  'Larisa',
  'Viktor',
  'Lyudmila',
  'Roman',
  'Nadejda',
  'Akmal',
  'Saodat',
  'Bahrom',
  'Mavluda',
  'Davlat',
  'Gulnora',
  'Farhod',
  'Munira',
  'Komron',
  'Zarrina',
  'Rustam',
  'Nodira',
  'Sherzod',
  'Dilshoda',
  'Muzaffar',
  'Sanam',
  'Nuriddin',
  'Charos',
  'Mansur',
  'Iroda',
  'Rahmatullo',
  'Anorgul',
  'Sirojiddin',
  'Marhabo',
  'Tolib',
  'Bibigul',
  'Karim',
  'Shahnoza',
  'Yodgor',
  'Tahmina',
  'Anvar',
  'Madina',
  'Bobur',
  'Robiya',
  'Doniyor',
  'Jamila',
  'Eldor',
  'Komila',
  'Faridun',
  'Latofat',
];

const LAST_NAMES = [
  'Yılmaz',
  'Kaya',
  'Demir',
  'Çelik',
  'Şahin',
  'Yıldız',
  'Yıldırım',
  'Öztürk',
  'Aydın',
  'Özdemir',
  'Arslan',
  'Doğan',
  'Kılıç',
  'Aslan',
  'Çetin',
  'Kara',
  'Koç',
  'Kurt',
  'Özkan',
  'Şimşek',
  'Polat',
  'Aksoy',
  'Erdoğan',
  'Tekin',
  'Güneş',
  'Korkmaz',
  'Acar',
  'Bulut',
  'Türk',
  'Atalay',
  'Ivanov',
  'Smirnov',
  'Kuznetsov',
  'Popov',
  'Vasilyev',
  'Petrov',
  'Sokolov',
  'Mikhailov',
  'Novikov',
  'Fyodorov',
  'Morozov',
  'Volkov',
  'Alekseev',
  'Lebedev',
  'Semyonov',
  'Yegorov',
  'Pavlov',
  'Kozlov',
  'Stepanov',
  'Nikolaev',
  'Orlov',
  'Andreev',
  'Makarov',
  'Nikitin',
  'Zakharov',
  'Zaytsev',
  'Solovyov',
  'Borisov',
  'Yakovlev',
  'Grigoryev',
  'Karimov',
  'Rahmonov',
  'Nazarov',
  'Sharipov',
  'Akhmedov',
  'Mirzoev',
  'Nazirov',
  'Saidov',
  'Kholov',
  'Yusupov',
  'Yuldoshev',
  'Tursunov',
  'Hakimov',
  'Davlatov',
  'Bobokhonov',
  'Olimov',
  'Ismoilov',
  'Ergashev',
  'Boboev',
  'Toshev',
  'Latifi',
  'Saidi',
  'Olimi',
  'Kholov',
  'Murodov',
  'Dzhalilov',
  'Khudoyberdiev',
  'Soliev',
  'Negmatov',
  'Kabirov',
  'Ahmadov',
  'Murodi',
  'Sodikov',
  'Tagaev',
  'Komilov',
  'Hojaev',
  'Kayumov',
  'Mirzoyev',
  'Nazirov',
  'Halimov',
];

const GENDERS = ['male', 'female', 'other'] as const;

// Mulberry32 — küçük, fast, deterministik PRNG. Aynı seed → aynı 10K kayıt.
function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(n: number, w: number): string {
  return n.toString().padStart(w, '0');
}

function makePhone(rng: () => number): string {
  // +992 (Tacikistan) prefix + 9 digit. Seed 4-haneli son grup `last4` index'ini
  // çeşitli kılar (000–9999), telefon arama testleri için.
  const a = Math.floor(rng() * 90 + 10); // 10-99
  const b = Math.floor(rng() * 9000 + 1000); // 1000-9999
  return `+992${a}${b}${pad(Math.floor(rng() * 10000), 4)}`;
}

function makeBirthDate(rng: () => number): Date {
  // 1940-01-01 .. 2010-12-31 arası (yaş 14-95)
  const start = new Date(1940, 0, 1).getTime();
  const end = new Date(2010, 11, 31).getTime();
  return new Date(start + rng() * (end - start));
}

async function main() {
  assertSeedAllowed('seed-perf');
  const reset = process.argv.includes('--reset');

  console.warn('[seed-perf] starting…');

  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMOEYE_SLUG } });
  if (!tenant) {
    throw new Error(`Tenant '${DEMOEYE_SLUG}' not found. Run 'npm run db:seed' first.`);
  }

  // RLS — set tenant context for inserts
  await prisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenant.id}'`);

  if (reset) {
    const deleted = await prisma.patient.deleteMany({
      where: { tenantId: tenant.id, mrn: { startsWith: PERF_MRN_PREFIX } },
    });
    console.warn(`[seed-perf] reset: deleted ${deleted.count} previous perf records`);
  }

  const existing = await prisma.patient.count({
    where: { tenantId: tenant.id, mrn: { startsWith: PERF_MRN_PREFIX } },
  });
  if (existing >= TARGET_COUNT) {
    console.warn(`[seed-perf] already have ${existing} perf records — skipping`);
    return;
  }

  const remaining = TARGET_COUNT - existing;
  console.warn(`[seed-perf] inserting ${remaining} fake patients…`);

  const rng = makeRng(20260510);
  const startedAt = Date.now();

  for (let batchStart = existing; batchStart < TARGET_COUNT; batchStart += BATCH_SIZE) {
    const batch = [];
    for (let i = batchStart; i < Math.min(batchStart + BATCH_SIZE, TARGET_COUNT); i++) {
      const firstName = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]!;
      const lastName = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]!;
      const phone = makePhone(rng);
      batch.push({
        tenantId: tenant.id,
        mrn: `${PERF_MRN_PREFIX}${pad(i, 8)}`,
        firstName,
        lastName,
        birthDate: makeBirthDate(rng),
        gender: GENDERS[Math.floor(rng() * GENDERS.length)]!,
        phone,
        phoneLast4: phone.slice(-4),
      });
    }
    await prisma.patient.createMany({ data: batch, skipDuplicates: true });
    process.stdout.write(
      `\r[seed-perf] inserted ${batch.length + batchStart - existing}/${remaining}`,
    );
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.warn(`\n[seed-perf] done ✓ (${elapsed}s)`);
}

main()
  .catch((err) => {
    console.error('[seed-perf] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
