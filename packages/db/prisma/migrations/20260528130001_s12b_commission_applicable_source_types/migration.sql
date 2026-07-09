-- S12b (devam) — CommissionRule'a applicable_source_types kolonu.
-- Boş array = hepsi (geriye uyumlu); kategorize edilirse yalnız listedekiler.

ALTER TABLE "commission_rules"
  ADD COLUMN "applicable_source_types" "CommissionSourceType"[] NOT NULL DEFAULT '{}';
