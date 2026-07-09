-- S11a — Tahsilat / Faturalama modülü
-- Tasarım: docs/audits/2026-05-28-tahsilat-modul-tasarimi.md (12 karar)
--
-- 6 yeni tablo:
--   service_items (hizmet kataloğu) → invoices → invoice_items
--                                              ↓
--                                            payments → refunds
--                                              ↓
--                                  cash_register_closures (Z-raporu)
--
-- Tüm tablolar: tenant_id + RLS + sync_outbox trigger.

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE "Currency" AS ENUM ('TJS', 'USD');
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'card', 'transfer', 'insurance');
CREATE TYPE "ServiceCategory" AS ENUM ('examination', 'surgery', 'procedure', 'lab', 'measurement', 'other');
CREATE TYPE "InvoiceStatus" AS ENUM ('open', 'partial', 'paid', 'cancelled', 'refunded');

-- =============================================================================
-- TABLO: service_items (hizmet kataloğu)
-- =============================================================================

CREATE TABLE "service_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "name_ru" VARCHAR(200),
    "name_tg" VARCHAR(200),
    "category" "ServiceCategory" NOT NULL,
    "default_price" DECIMAL(10,2) NOT NULL,
    "default_currency" "Currency" NOT NULL DEFAULT 'TJS',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "service_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_items_tenant_id_code_key" ON "service_items"("tenant_id", "code");
CREATE INDEX "service_items_tenant_id_category_is_active_idx" ON "service_items"("tenant_id", "category", "is_active");
CREATE INDEX "service_items_tenant_id_deleted_at_idx" ON "service_items"("tenant_id", "deleted_at");

ALTER TABLE "service_items" ADD CONSTRAINT "service_items_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- TABLO: invoices (fatura)
-- =============================================================================

CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_number" VARCHAR(20) NOT NULL,
    "patient_id" UUID NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'open',
    "currency" "Currency" NOT NULL DEFAULT 'TJS',
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "surgery_id" UUID,
    "procedure_id" UUID,
    "appointment_id" UUID,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" UUID,
    "cancel_reason" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_tenant_id_invoice_number_key" ON "invoices"("tenant_id", "invoice_number");
CREATE INDEX "invoices_tenant_id_patient_id_created_at_idx" ON "invoices"("tenant_id", "patient_id", "created_at" DESC);
CREATE INDEX "invoices_tenant_id_status_created_at_idx" ON "invoices"("tenant_id", "status", "created_at" DESC);
CREATE INDEX "invoices_tenant_id_surgery_id_idx" ON "invoices"("tenant_id", "surgery_id");
CREATE INDEX "invoices_tenant_id_procedure_id_idx" ON "invoices"("tenant_id", "procedure_id");
CREATE INDEX "invoices_tenant_id_deleted_at_idx" ON "invoices"("tenant_id", "deleted_at");

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_surgery_id_fkey"
    FOREIGN KEY ("surgery_id") REFERENCES "surgeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_procedure_id_fkey"
    FOREIGN KEY ("procedure_id") REFERENCES "procedures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cancelled_by_id_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- TABLO: invoice_items (fatura kalemleri)
-- =============================================================================

CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "service_item_id" UUID,
    "description" VARCHAR(300) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "line_total" DECIMAL(10,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_items_tenant_id_invoice_id_idx" ON "invoice_items"("tenant_id", "invoice_id");

ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_service_item_id_fkey"
    FOREIGN KEY ("service_item_id") REFERENCES "service_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- TABLO: cash_register_closures (Z-raporu — Payment'tan ÖNCE oluşturuyoruz
-- çünkü Payment FK ona referans veriyor)
-- =============================================================================

CREATE TABLE "cash_register_closures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by_id" UUID NOT NULL,
    "total_tjs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_tjs_equivalent" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cash_tjs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cash_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "card_tjs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "card_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "transfer_tjs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "transfer_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "insurance_tjs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "insurance_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refund_tjs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refund_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_tjs_equivalent" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_count" INTEGER NOT NULL DEFAULT 0,
    "refund_count" INTEGER NOT NULL DEFAULT 0,
    "notes" VARCHAR(1000),
    CONSTRAINT "cash_register_closures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_register_closures_tenant_id_closed_at_idx" ON "cash_register_closures"("tenant_id", "closed_at" DESC);

ALTER TABLE "cash_register_closures" ADD CONSTRAINT "cash_register_closures_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_register_closures" ADD CONSTRAINT "cash_register_closures_closed_by_id_fkey"
    FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- TABLO: payments (tahsilat)
-- =============================================================================

CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "exchange_rate" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "tjs_equivalent" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference_number" VARCHAR(100),
    "notes" VARCHAR(500),
    "taken_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taken_by_id" UUID NOT NULL,
    "cash_register_closure_id" UUID,
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payments_tenant_id_invoice_id_taken_at_idx" ON "payments"("tenant_id", "invoice_id", "taken_at");
CREATE INDEX "payments_tenant_id_taken_at_idx" ON "payments"("tenant_id", "taken_at" DESC);
CREATE INDEX "payments_tenant_id_cash_register_closure_id_idx" ON "payments"("tenant_id", "cash_register_closure_id");
CREATE INDEX "payments_tenant_id_deleted_at_idx" ON "payments"("tenant_id", "deleted_at");

ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_taken_by_id_fkey"
    FOREIGN KEY ("taken_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_register_closure_id_fkey"
    FOREIGN KEY ("cash_register_closure_id") REFERENCES "cash_register_closures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- TABLO: refunds (iade)
-- =============================================================================

CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "tjs_equivalent" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "approved_by_id" UUID NOT NULL,
    "refunded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cash_register_closure_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "refunds_tenant_id_payment_id_idx" ON "refunds"("tenant_id", "payment_id");
CREATE INDEX "refunds_tenant_id_refunded_at_idx" ON "refunds"("tenant_id", "refunded_at" DESC);
CREATE INDEX "refunds_tenant_id_cash_register_closure_id_idx" ON "refunds"("tenant_id", "cash_register_closure_id");

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_id_fkey"
    FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_cash_register_closure_id_fkey"
    FOREIGN KEY ("cash_register_closure_id") REFERENCES "cash_register_closures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- RLS — Tüm 6 tablo tenant isolation (mevcut pattern)
-- =============================================================================

ALTER TABLE "service_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "service_items_tenant_isolation" ON "service_items"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY "invoices_tenant_isolation" ON "invoices"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "invoice_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "invoice_items_tenant_isolation" ON "invoice_items"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "payments_tenant_isolation" ON "payments"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refunds" FORCE ROW LEVEL SECURITY;
CREATE POLICY "refunds_tenant_isolation" ON "refunds"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "cash_register_closures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_register_closures" FORCE ROW LEVEL SECURITY;
CREATE POLICY "cash_register_closures_tenant_isolation" ON "cash_register_closures"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- =============================================================================
-- Sync outbox triggers (hibrit lokal ↔ cloud)
-- =============================================================================

CREATE TRIGGER service_items_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON service_items
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('service_item');

CREATE TRIGGER invoices_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('invoice');

CREATE TRIGGER invoice_items_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('invoice_item');

CREATE TRIGGER payments_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('payment');

CREATE TRIGGER refunds_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('refund');

CREATE TRIGGER cash_register_closures_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON cash_register_closures
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('cash_register_closure');

-- =============================================================================
-- airmed_app role'üne GRANT (mevcut pattern; app user RLS scope'unda işliyor)
-- Rol yoksa atla (fresh DB / CI'da migrate, airmed_app oluşturulmadan önce
-- çalışabilir → 42704'ü önle). patient_photos migration'ıyla aynı guard.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON service_items, invoices, invoice_items, payments, refunds, cash_register_closures TO airmed_app';
  END IF;
END$$;
