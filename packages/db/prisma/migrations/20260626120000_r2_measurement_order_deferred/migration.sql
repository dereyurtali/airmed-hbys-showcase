-- R2 (#724) — Ölçüm talebi "ertele/skip": ölçüm hemşiresi hazır olmayan talebi
-- erteler (hasta gelmedi / cihaz meşgul). Aktif kuyruktan çıkar, "Ertelenenler"
-- görünümünde "Geri al" ile döner. Sebep notlara eklenir + audit (app katmanı).
ALTER TYPE "MeasurementOrderStatus" ADD VALUE IF NOT EXISTS 'deferred';
