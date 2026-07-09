-- #916 — airmed_bg (NOSUPERUSER BYPASSRLS) rolü: ayrıcalıklı arkaplan/cross-tenant
-- Prisma client'larının artık postgres superuser (DATABASE_URL) yerine bu role
-- bağlanması için. RLS'i bypass eder ama superuser DEĞİL → sync/$executeRawUnsafe
-- gibi raw-SQL yollarında injection tam DB ele geçirmeye yükselemez.
--
-- Fresh DB'lerde rolü init.sh LOGIN + parola ile kurar (bu migration'dan ÖNCE);
-- o durumda buradaki CREATE atlanır, yalnız grant'lar idempotent tekrar uygulanır.
-- Mevcut (eski init'li) staging/prod DB'lerinde rol yoktur → NOLOGIN (parolasız,
-- login edemez = güvenli) yaratılır. Ops rolü aktive eder:
--   ALTER ROLE airmed_bg WITH LOGIN PASSWORD '<guclu>';
-- sonra DATABASE_URL_BG'yi airmed_bg'ye çevirir + api'yi restart eder. Aktive
-- edilene kadar servisler DATABASE_URL_BG ?? DATABASE_URL fallback'iyle çalışır.
--
-- session_replication_role: sync.service trigger'ları kapatmak için
-- SET session_replication_role='replica' çağırır (PG16: parametre-bazlı grant,
-- superuser gerekmez).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_bg') THEN
    CREATE ROLE airmed_bg WITH NOLOGIN NOSUPERUSER BYPASSRLS;
  END IF;

  EXECUTE 'GRANT CONNECT ON DATABASE airmed_hbys TO airmed_bg';
  EXECUTE 'GRANT USAGE ON SCHEMA public TO airmed_bg';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO airmed_bg';
  EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO airmed_bg';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO airmed_bg';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO airmed_bg';
  EXECUTE 'GRANT SET ON PARAMETER session_replication_role TO airmed_bg';
END
$$;
