// A4 hasta arama performans — index varlığı ve EXPLAIN plan smoke testi.
//
// Asıl yük testi Artillery (apps/api/perf/patient-search.yml) ile dev runtime'da
// koşulur; bu spec CI'da yalnızca migration'ın doğru index'leri ürettiğini ve
// search query'sinin çalıştığını doğrular. 10K kayıt seed'i CI'da yapmıyoruz —
// ufak fixture seti üzerinde planner GIN'i tercih etmeyebilir, dolayısıyla
// "Bitmap Index Scan" assertion'ı yapmıyoruz; bu Artillery'nin işi.

import { PrismaClient } from '@airmed/db';

const REQUIRED_INDEXES = [
  'patients_first_name_trgm',
  'patients_last_name_trgm',
  'patients_phone_trgm',
  'patients_mrn_trgm',
];

describe('A4 patient search GIN trigram indexes', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(REQUIRED_INDEXES)('index %s exists on patients table with gin method', async (idx) => {
    const rows = await prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'patients' AND indexname = $1`,
      idx,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/USING gin/i);
    expect(rows[0]!.indexdef).toMatch(/gin_trgm_ops/i);
  });

  it('LIKE search query plan is selectable (smoke)', async () => {
    // EXPLAIN (no ANALYZE — dry plan, fast). Just verifies the planner can
    // produce a plan for the search query without erroring out. Whether it
    // picks the GIN index depends on row count, which we don't control here.
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN SELECT id FROM patients WHERE first_name ILIKE '%ali%' LIMIT 20`,
    );
    expect(plan.length).toBeGreaterThan(0);
  });
});

// #417 — Kiril (RU/TG) collation: isim kolonları ICU "und-x-icu" ile sıralanır;
// arama case-insensitive (ILIKE) Kiril + Tacik özel harflerinde çalışır.
describe('#417 Cyrillic/Tajik name collation', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(['first_name', 'last_name'])('%s column uses und-x-icu collation', async (col) => {
    const rows = await prisma.$queryRawUnsafe<{ collation_name: string | null }[]>(
      `SELECT collation_name FROM information_schema.columns
       WHERE table_name = 'patients' AND column_name = $1`,
      col,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.collation_name).toBe('und-x-icu');
  });

  it('ILIKE case-folds Cyrillic (Иван matches иван)', async () => {
    const [row] = await prisma.$queryRawUnsafe<{ eq: boolean; sub: boolean }[]>(
      `SELECT ('Иван' ILIKE 'иван') AS eq, ('Иван' ILIKE '%ван%') AS sub`,
    );
    expect(row!.eq).toBe(true);
    expect(row!.sub).toBe(true);
  });

  it('ILIKE case-folds Tajik extended Cyrillic (Ҳасан matches ҳасан)', async () => {
    const [row] = await prisma.$queryRawUnsafe<{ eq: boolean }[]>(
      `SELECT ('Ҳасан' ILIKE 'ҳасан') AS eq`,
    );
    expect(row!.eq).toBe(true);
  });

  it('ICU collation orders Tajik chars alphabetically, not by codepoint', async () => {
    // glibc en_US.utf8 atar Ғ/Қ/Ҳ'yi en sona; und-x-icu doğru intermixed sıra:
    // Ахмад < Бобо < Ғафур < Иван < Қодир < Ҳасан < Яков (büyük/küçük bitişik).
    const rows = await prisma.$queryRawUnsafe<{ x: string }[]>(
      `WITH n(x) AS (VALUES ('Яков'),('Иван'),('Ахмад'),('Ҳасан'),('Бобо'),('Ғафур'),('Қодир'))
       SELECT x FROM n ORDER BY x COLLATE "und-x-icu"`,
    );
    expect(rows.map((r) => r.x)).toEqual([
      'Ахмад',
      'Бобо',
      'Ғафур',
      'Иван',
      'Қодир',
      'Ҳасан',
      'Яков',
    ]);
  });
});
