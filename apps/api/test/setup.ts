import { execSync } from 'child_process';
import * as path from 'path';
import { PrismaClient } from '@airmed/db';

/**
 * Worker'a izole DB adı. per-worker-db.ts AYNI formülü kullanır — birini
 * değiştirirsen diğerini de değiştir.
 */
export function workerDbName(baseDb: string, workerId: string | number): string {
  return `${baseDb}_w${workerId}`;
}

function withDbName(dbUrl: string, dbName: string): string {
  const u = new URL(dbUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

function dbNameOf(dbUrl: string): string {
  return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0];
}

async function dropDb(maint: PrismaClient, dbName: string): Promise<void> {
  // FORCE (PG13+): önceki run'dan kalan bağlı session'ları kopar, yoksa
  // DROP "still being accessed" ile patlar.
  await maint.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
}

/**
 * Jest globalSetup — e2e için worker-başına İZOLE DB sağlar.
 *
 * Eski model tek DB'ye 78 suite'i `--runInBand` ile diziyordu → paralelleşemez
 * (29 dk) + tek process'te kaynak birikmesi rastgele timeout/pollution
 * (flaky). Yeni model: bir migrate edilmiş TEMPLATE DB kur, sonra worker başına
 * `CREATE DATABASE ... TEMPLATE` ile hızlı klonla. Her jest worker'ı kendi
 * process'inde + kendi DB'sinde koşar → çakışma yok, paralel (29dk → ~7dk).
 *
 * DB sayısı = maxWorkers (jest 50%'yi tamsayıya çözer). Klonlar template'ten
 * tüm şema + grant + extension + RLS politikasını alır; sadece DATABASE-seviye
 * CONNECT grant'i (DB objesine bağlı, klona kopyalanmaz) ayrıca verilir.
 *
 * per-worker-db.ts (setupFiles) her worker'da DATABASE_URL/_APP'i kendi
 * `<base>_w{id}` DB'sine yönlendirir.
 */
export default async function globalSetup(globalConfig: { maxWorkers?: number }): Promise<void> {
  // Mark this run as a test so request-rate guards (ThrottlerModule, etc.) lift
  // their caps; jest does not set NODE_ENV reliably in every shell.
  process.env.NODE_ENV ??= 'test';
  // Platform IP allowlist guard would 403 every supertest call (127.0.0.1 is
  // not seeded as a CIDR row); the dev escape hatch is the right channel.
  process.env.DEV_PLATFORM_OPEN_IPS ??= 'true';
  // Impersonation JWT secret — API boot + token helper bunu zorunlu kılıyor.
  process.env.PLATFORM_IMPERSONATION_JWT_SECRET ??=
    'test_impersonation_secret_dummy_value_for_ci_only';

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set for e2e tests');
  }
  const baseUrl = process.env.DATABASE_URL;
  const baseDb = dbNameOf(baseUrl);
  if (!baseDb) throw new Error('DATABASE_URL must include a database name');

  const templateDb = `${baseDb}_tmpl`;
  const templateUrl = withDbName(baseUrl, templateDb);
  const maintUrl = withDbName(baseUrl, 'postgres'); // CREATE/DROP DATABASE buradan
  const dbDir = path.resolve(__dirname, '../../../packages/db');
  const workers = Math.max(1, globalConfig.maxWorkers ?? 1);

  // 1. Rol (cluster-geneli, bir kez) + temiz template DB.
  const maint = new PrismaClient({ datasources: { db: { url: maintUrl } } });
  try {
    await maint.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_app') THEN
          CREATE ROLE airmed_app WITH LOGIN PASSWORD 'airmed_app_dev' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END$$;
    `);
    await dropDb(maint, templateDb);
    await maint.$executeRawUnsafe(`CREATE DATABASE "${templateDb}"`);
  } finally {
    await maint.$disconnect();
  }

  // 2. Template'i migrate et + airmed_app grant'leri. Grant'ler (rol + CONNECT
  //    + tablo) klona kopyalanacak (tablo/şema grant'leri DB içinde tutulur).
  const tmpl = new PrismaClient({ datasources: { db: { url: templateUrl } } });
  try {
    await tmpl.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${templateDb}" TO airmed_app`);
    await tmpl.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO airmed_app`);
    execSync('npx prisma migrate deploy', {
      cwd: dbDir,
      env: { ...process.env, DATABASE_URL: templateUrl },
      stdio: 'inherit',
    });
    await tmpl.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO airmed_app`,
    );
    await tmpl.$executeRawUnsafe(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO airmed_app`);
    await tmpl.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO airmed_app`,
    );
    await tmpl.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO airmed_app`,
    );
  } finally {
    await tmpl.$disconnect();
  }

  // 3. Worker başına izole DB: template'ten klonla (hızlı, migrate tekrarı yok).
  //    DATABASE-seviye CONNECT grant'i DB objesine bağlı → klona kopyalanmaz,
  //    her klona ayrıca ver.
  const cloner = new PrismaClient({ datasources: { db: { url: maintUrl } } });
  try {
    for (let i = 1; i <= workers; i++) {
      const wdb = workerDbName(baseDb, i);
      await dropDb(cloner, wdb);
      await cloner.$executeRawUnsafe(`CREATE DATABASE "${wdb}" TEMPLATE "${templateDb}"`);
      await cloner.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${wdb}" TO airmed_app`);
    }
  } finally {
    await cloner.$disconnect();
  }
}
