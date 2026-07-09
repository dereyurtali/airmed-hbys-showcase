-- #915 — airmed_app (RLS runtime rolü) rolünden TRUNCATE yetkisini kaldır.
--
-- Sorun: 20260605170000_grant_app_role_schema_access airmed_app'e
-- `GRANT ... TRUNCATE ON ALL TABLES` veriyordu. RLS TRUNCATE'i filtrelemez →
-- SQL injection ya da kod hatasıyla tetiklenen tek bir TRUNCATE tüm tenant'ların
-- verisini RLS'i bypass ederek siler. Günlük CRUD'da TRUNCATE ihtiyacı yok.
--
-- Eski grant migration'ı düzenlenemez (uygulanmış DB'lerde checksum kırılır);
-- bunun yerine bu migration mevcut tablolardan REVOKE eder + default
-- privileges'ten TRUNCATE'i çıkarır (gelecekteki tablolar). init.sql (fresh DB)
-- da güncellendi. Rol yoksa (fresh/CI) atla.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_app') THEN
    EXECUTE 'REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM airmed_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM airmed_app';
  END IF;
END
$$;
