-- #923 — invoice_counters: fatura numarası (YYYY-NNNN) atomik per-tenant/yıl
-- sayacı (MrnCounter deseni). Eski nextInvoiceNumber findFirst+parse+increment
-- serializable DEĞİLDİ → eşzamanlı iki fatura aynı numarayı üretip
-- @@unique([tenantId, invoiceNumber]) ihlali / duplicate riski taşıyordu.

CREATE TABLE "invoice_counters" (
  "tenant_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "last_seq" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("tenant_id", "year"),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

ALTER TABLE "invoice_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_counters" FORCE ROW LEVEL SECURITY;
CREATE POLICY "invoice_counters_tenant_isolation" ON "invoice_counters"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- Mevcut faturalardan geriye doldur: sayaç mevcut max seq'ten devam etsin ki
-- ilk atomik numara mevcut faturayla ÇAKIŞMASIN. Migration superuser (BYPASSRLS)
-- koşar → tüm tenant'ların faturalarını görür.
INSERT INTO "invoice_counters" ("tenant_id", "year", "last_seq")
SELECT
  "tenant_id",
  CAST(split_part("invoice_number", '-', 1) AS INTEGER) AS yr,
  MAX(CAST(split_part("invoice_number", '-', 2) AS INTEGER)) AS max_seq
FROM "invoices"
WHERE "invoice_number" ~ '^[0-9]{4}-[0-9]+$'
GROUP BY "tenant_id", CAST(split_part("invoice_number", '-', 1) AS INTEGER)
ON CONFLICT ("tenant_id", "year")
DO UPDATE SET "last_seq" = GREATEST("invoice_counters"."last_seq", EXCLUDED."last_seq");
