-- airmed_app (RLS runtime role) için public schema erişimini kalıcı hale getir.
--
-- Sorun: `prisma migrate reset` ve `DROP SCHEMA public CASCADE` sonrası
-- docker/postgres/init.sql'deki GRANT'ler uçar. Migration'lar tek tek replay
-- edildiğinde tablo-bazlı GRANT'ler (örn. patient_photos, billing tabloları)
-- işler ama schema-seviyesi USAGE + tüm tablolar için kapsayıcı GRANT atanmaz.
-- Sonuç: AuthService gibi RLS user'ı kullanan tüm sorgular "permission denied
-- for schema public" alır.
--
-- Çözüm: schema-seviyesi USAGE + ALL TABLES + DEFAULT PRIVILEGES'i migration
-- olarak idempotent uygula. Hem prod (`migrate deploy`) hem dev (`migrate reset`)
-- akışlarında otomatik çalışır; init.sql ile çakışmaz (GRANT yeniden verme
-- güvenli, default privileges'i ALTER ile günceller).
--
-- Rol yoksa atla (fresh DB veya CI'da airmed_app oluşturulmamış olabilir).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO airmed_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO airmed_app';
    EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO airmed_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO airmed_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO airmed_app';
  END IF;
END
$$;
