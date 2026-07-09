-- S11e/#419 — Döviz kuru snapshot altyapısı (NBT cron kaynağı + fatura snapshot).

-- Tenant-scoped kur geçmişi tablosu (cron her tenant için NBT kurunu upsert eder).
CREATE TABLE "exchange_rates" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "base_currency" VARCHAR(3) NOT NULL,
  "quote_currency" VARCHAR(3) NOT NULL,
  "rate" DECIMAL(12,4) NOT NULL,
  "as_of" TIMESTAMP(3) NOT NULL,
  "source" VARCHAR(40) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "exchange_rates_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION
);

CREATE INDEX "exchange_rates_lookup_idx"
  ON "exchange_rates" ("tenant_id", "base_currency", "quote_currency", "as_of" DESC);

-- RLS — kanonik pattern (app.current_tenant_id, NULLIF formu).
ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exchange_rates_tenant_isolation" ON "exchange_rates"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Fatura kesim-anı kur snapshot'ı. Default 1 (TJS fatura); USD legacy backfill 11.
ALTER TABLE "invoices"
  ADD COLUMN "exchange_rate" DECIMAL(12,4) NOT NULL DEFAULT 1;

UPDATE "invoices" SET "exchange_rate" = 11 WHERE "currency" = 'USD';
