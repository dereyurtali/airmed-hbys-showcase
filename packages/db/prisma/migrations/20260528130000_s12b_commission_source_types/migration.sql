-- S12b — CommissionSourceType enum'a 3 yeni değer.
-- müşteri görüşmesi (2026-05-28): "Doktor her işlemden hakediş alıyor"
-- (docs/audits/2026-05-28-fahri-toplantisi-sonrasi.md karar 2)
--
-- NOTE: Postgres ALTER TYPE ADD VALUE aynı tx'te kullanılamaz.
-- Bu migration sadece enum genişletir; column ekleme ayrı dosyada.

ALTER TYPE "CommissionSourceType" ADD VALUE IF NOT EXISTS 'examination';
ALTER TYPE "CommissionSourceType" ADD VALUE IF NOT EXISTS 'lab';
ALTER TYPE "CommissionSourceType" ADD VALUE IF NOT EXISTS 'measurement';
