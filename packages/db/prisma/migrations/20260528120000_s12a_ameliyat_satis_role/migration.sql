-- S12a — RoleKey enum'una `ameliyat_satis` değeri (müşteri görüşmesi sonrası).
-- Karar tutanağı: docs/audits/2026-05-28-fahri-toplantisi-sonrasi.md
--
-- NOTE: Postgres "ALTER TYPE ... ADD VALUE" aynı transaction'da kullanılamaz.
-- INSERT bir sonraki migration'da: 20260528120001_s12a_seed_ameliyat_satis_role

ALTER TYPE "RoleKey" ADD VALUE IF NOT EXISTS 'ameliyat_satis';
