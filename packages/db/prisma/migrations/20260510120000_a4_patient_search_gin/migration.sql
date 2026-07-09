-- A4 hasta arama performans — GIN trigram index'leri.
--
-- Mevcut `patient.list` `searchFilter` (apps/api/src/patient/patient.service.ts)
-- `firstName`, `lastName`, `phone`, `mrn` üzerinde `LIKE '%q%'` ile çalışır.
-- Postgres 9.1+ pg_trgm `gin_trgm_ops` ile bu pattern'i index'ler — 10K
-- kayıtta seq scan yerine bitmap index scan kullanır, p95 ~2sn → <500ms düşer.
--
-- pg_trgm extension 20260505190118_init_multitenant'ta enable edildi,
-- ek extension migration'ı gerekmiyor.
--
-- Notlar:
-- - phoneLast4 (varchar(4)) zaten btree composite index'inde; trigram katma değer yok.
-- - mrn 9 digit deterministik string; substring arama için trigram fayda sağlar
--   (örn. "12345" prefix'i ile arama).
-- - CREATE INDEX `IF NOT EXISTS` migration replay güvenliği için.

CREATE INDEX IF NOT EXISTS "patients_first_name_trgm"
  ON "patients" USING gin ("first_name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "patients_last_name_trgm"
  ON "patients" USING gin ("last_name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "patients_phone_trgm"
  ON "patients" USING gin ("phone" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "patients_mrn_trgm"
  ON "patients" USING gin ("mrn" gin_trgm_ops);
