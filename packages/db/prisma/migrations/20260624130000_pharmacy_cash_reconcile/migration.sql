-- #664 — 2-aşama kasa devri: finans mutabakatı (reconcile) alanları.
-- Akış: eczacı closeCash → handToFinance → FİNANS reconcileCash (görev ayrılığı:
-- teslim eden ≠ mutabakat eden, service guard). reconciled_at set = finans onayladı.
-- RLS + sync_outbox trigger pharmacy_cash_closures'ta zaten var; yeni kolonlar
-- tablo RLS'ine tabidir, UPDATE sync_outbox'a düşer. Enum değişmez (durum
-- handed_to_finance kalır; reconciled_at != null = mutabık).
ALTER TABLE "pharmacy_cash_closures" ADD COLUMN "reconciled_at" TIMESTAMP(3);
ALTER TABLE "pharmacy_cash_closures" ADD COLUMN "reconciled_by_id" UUID;

ALTER TABLE "pharmacy_cash_closures" ADD CONSTRAINT "pharmacy_cash_closures_reconciled_by_id_fkey"
    FOREIGN KEY ("reconciled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
