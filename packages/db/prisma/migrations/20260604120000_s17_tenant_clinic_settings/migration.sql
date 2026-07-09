-- S17 — Klinik ayarları: Tenant'a iletişim/marka alanları
-- Tümü NULL'lanabilir; mevcut satırlar için backfill gerekmez.

ALTER TABLE "tenants"
  ADD COLUMN "address"     VARCHAR(500),
  ADD COLUMN "phone"       VARCHAR(50),
  ADD COLUMN "email"       VARCHAR(255),
  ADD COLUMN "logo_url"    VARCHAR(1000),
  ADD COLUMN "legal_name"  VARCHAR(255),
  ADD COLUMN "tax_id"      VARCHAR(50);
