-- v0.4 #551 — Eczane Perakende (Pharmacy Retail) veritabanı yapısı.
--
-- Klinik stoğundan (iol_models/consumables/service_items) TAMAMEN ayrı: perakende
-- POS satış, parti/SKT bazlı satış fiyatı, gün sonu kasa + finansa teslim. Tedarikçi
-- ortak `suppliers`, sipariş ortak `purchase_orders(domain='pharmacy')` (#548).
-- KVKK: walk-in satış anonim olabilir. Reçete → satış köprüsü (#552 mantığı).
--
-- 8 tablo, hepsi: tenant_id + RLS + sync_outbox. Bu migration #548'den sonra (timestamp).

-- =============================================================================
-- ENUMS
-- =============================================================================
CREATE TYPE "PharmacySaleStatus" AS ENUM ('completed', 'voided');
CREATE TYPE "PharmacyCashStatus" AS ENUM ('open', 'closed', 'handed_to_finance');
CREATE TYPE "PharmacyMovementType" AS ENUM ('intake', 'sale', 'return', 'adjustment', 'disposal', 'expire');

-- =============================================================================
-- TABLOLAR (önce tüm tablolar, sonra FK'lar — çapraz referans için)
-- =============================================================================
CREATE TABLE "pharmacy_products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "barcode" VARCHAR(64),
    "name" VARCHAR(200) NOT NULL,
    "name_ru" VARCHAR(200),
    "name_tg" VARCHAR(200),
    "category" VARCHAR(60),
    "unit" VARCHAR(30),
    "requires_prescription" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "pharmacy_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pharmacy_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_number" VARCHAR(100),
    "expires_at" DATE,
    "cost_price" DECIMAL(10,2),
    "sale_price" DECIMAL(10,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TJS',
    "available_qty" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "supplier_id" UUID,
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "pharmacy_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pharmacy_sales" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_no" VARCHAR(30) NOT NULL,
    "status" "PharmacySaleStatus" NOT NULL DEFAULT 'completed',
    "is_anonymous" BOOLEAN NOT NULL DEFAULT true,
    "patient_id" UUID,
    "prescription_id" UUID,
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'TJS',
    "payment_method" "PaymentMethod" NOT NULL DEFAULT 'cash',
    "cash_closure_id" UUID,
    "sold_by_id" UUID,
    "voided_at" TIMESTAMP(3),
    "sold_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "pharmacy_sales_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pharmacy_sale_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID,
    "batch_id" UUID,
    "item_name" VARCHAR(200) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pharmacy_sale_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pharmacy_returns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "return_no" VARCHAR(30) NOT NULL,
    "sale_id" UUID NOT NULL,
    "reason" VARCHAR(500),
    "total_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'TJS',
    "processed_by_id" UUID,
    "cash_closure_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pharmacy_returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pharmacy_return_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "sale_item_id" UUID,
    "product_id" UUID,
    "batch_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pharmacy_return_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pharmacy_cash_closures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "status" "PharmacyCashStatus" NOT NULL DEFAULT 'open',
    "currency" "Currency" NOT NULL DEFAULT 'TJS',
    "opening_float" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sales_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refund_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expected_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "counted_amount" DECIMAL(12,2),
    "variance" DECIMAL(12,2),
    "sale_count" INTEGER NOT NULL DEFAULT 0,
    "refund_count" INTEGER NOT NULL DEFAULT 0,
    "opened_by_id" UUID,
    "closed_by_id" UUID,
    "handed_to_finance_at" TIMESTAMP(3),
    "handed_to_finance_by_id" UUID,
    "notes" VARCHAR(1000),
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pharmacy_cash_closures_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pharmacy_stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_id" UUID,
    "type" "PharmacyMovementType" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "reference_type" VARCHAR(40),
    "reference_id" UUID,
    "notes" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pharmacy_stock_movements_pkey" PRIMARY KEY ("id")
);

-- =============================================================================
-- INDEX'ler
-- =============================================================================
CREATE UNIQUE INDEX "pharmacy_products_tenant_id_code_key" ON "pharmacy_products"("tenant_id", "code");
CREATE INDEX "pharmacy_products_tenant_id_barcode_idx" ON "pharmacy_products"("tenant_id", "barcode");
CREATE INDEX "pharmacy_products_tenant_id_is_active_deleted_at_idx" ON "pharmacy_products"("tenant_id", "is_active", "deleted_at");

CREATE INDEX "pharmacy_batches_tenant_id_product_id_expires_at_idx" ON "pharmacy_batches"("tenant_id", "product_id", "expires_at");
CREATE INDEX "pharmacy_batches_tenant_id_deleted_at_idx" ON "pharmacy_batches"("tenant_id", "deleted_at");

CREATE UNIQUE INDEX "pharmacy_sales_tenant_id_sale_no_key" ON "pharmacy_sales"("tenant_id", "sale_no");
CREATE INDEX "pharmacy_sales_tenant_id_sold_at_idx" ON "pharmacy_sales"("tenant_id", "sold_at" DESC);
CREATE INDEX "pharmacy_sales_tenant_id_status_deleted_at_idx" ON "pharmacy_sales"("tenant_id", "status", "deleted_at");
CREATE INDEX "pharmacy_sales_tenant_id_cash_closure_id_idx" ON "pharmacy_sales"("tenant_id", "cash_closure_id");

CREATE INDEX "pharmacy_sale_items_tenant_id_sale_id_idx" ON "pharmacy_sale_items"("tenant_id", "sale_id");

CREATE UNIQUE INDEX "pharmacy_returns_tenant_id_return_no_key" ON "pharmacy_returns"("tenant_id", "return_no");
CREATE INDEX "pharmacy_returns_tenant_id_sale_id_idx" ON "pharmacy_returns"("tenant_id", "sale_id");
CREATE INDEX "pharmacy_returns_tenant_id_created_at_idx" ON "pharmacy_returns"("tenant_id", "created_at" DESC);

CREATE INDEX "pharmacy_return_items_tenant_id_return_id_idx" ON "pharmacy_return_items"("tenant_id", "return_id");

CREATE INDEX "pharmacy_cash_closures_tenant_id_business_date_idx" ON "pharmacy_cash_closures"("tenant_id", "business_date" DESC);
CREATE INDEX "pharmacy_cash_closures_tenant_id_status_idx" ON "pharmacy_cash_closures"("tenant_id", "status");

CREATE INDEX "pharmacy_stock_movements_tenant_id_product_id_created_at_idx" ON "pharmacy_stock_movements"("tenant_id", "product_id", "created_at" DESC);
CREATE INDEX "pharmacy_stock_movements_tenant_id_type_created_at_idx" ON "pharmacy_stock_movements"("tenant_id", "type", "created_at" DESC);

-- =============================================================================
-- FOREIGN KEY'ler
-- =============================================================================
ALTER TABLE "pharmacy_products" ADD CONSTRAINT "pharmacy_products_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pharmacy_batches" ADD CONSTRAINT "pharmacy_batches_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_batches" ADD CONSTRAINT "pharmacy_batches_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "pharmacy_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_batches" ADD CONSTRAINT "pharmacy_batches_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_prescription_id_fkey"
    FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_sold_by_id_fkey"
    FOREIGN KEY ("sold_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_cash_closure_id_fkey"
    FOREIGN KEY ("cash_closure_id") REFERENCES "pharmacy_cash_closures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pharmacy_sale_items" ADD CONSTRAINT "pharmacy_sale_items_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_sale_items" ADD CONSTRAINT "pharmacy_sale_items_sale_id_fkey"
    FOREIGN KEY ("sale_id") REFERENCES "pharmacy_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pharmacy_sale_items" ADD CONSTRAINT "pharmacy_sale_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "pharmacy_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pharmacy_sale_items" ADD CONSTRAINT "pharmacy_sale_items_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "pharmacy_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pharmacy_returns" ADD CONSTRAINT "pharmacy_returns_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_returns" ADD CONSTRAINT "pharmacy_returns_sale_id_fkey"
    FOREIGN KEY ("sale_id") REFERENCES "pharmacy_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_returns" ADD CONSTRAINT "pharmacy_returns_processed_by_id_fkey"
    FOREIGN KEY ("processed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pharmacy_returns" ADD CONSTRAINT "pharmacy_returns_cash_closure_id_fkey"
    FOREIGN KEY ("cash_closure_id") REFERENCES "pharmacy_cash_closures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pharmacy_return_items" ADD CONSTRAINT "pharmacy_return_items_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_return_items" ADD CONSTRAINT "pharmacy_return_items_return_id_fkey"
    FOREIGN KEY ("return_id") REFERENCES "pharmacy_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pharmacy_cash_closures" ADD CONSTRAINT "pharmacy_cash_closures_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_cash_closures" ADD CONSTRAINT "pharmacy_cash_closures_opened_by_id_fkey"
    FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pharmacy_cash_closures" ADD CONSTRAINT "pharmacy_cash_closures_closed_by_id_fkey"
    FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pharmacy_cash_closures" ADD CONSTRAINT "pharmacy_cash_closures_handed_to_finance_by_id_fkey"
    FOREIGN KEY ("handed_to_finance_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pharmacy_stock_movements" ADD CONSTRAINT "pharmacy_stock_movements_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_stock_movements" ADD CONSTRAINT "pharmacy_stock_movements_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "pharmacy_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_stock_movements" ADD CONSTRAINT "pharmacy_stock_movements_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "pharmacy_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pharmacy_stock_movements" ADD CONSTRAINT "pharmacy_stock_movements_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- RLS — kanonik pattern (app.current_tenant_id, NULLIF formu).
-- =============================================================================
ALTER TABLE "pharmacy_products" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pharmacy_products_tenant_isolation" ON "pharmacy_products"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "pharmacy_batches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pharmacy_batches_tenant_isolation" ON "pharmacy_batches"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "pharmacy_sales" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pharmacy_sales_tenant_isolation" ON "pharmacy_sales"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "pharmacy_sale_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pharmacy_sale_items_tenant_isolation" ON "pharmacy_sale_items"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "pharmacy_returns" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pharmacy_returns_tenant_isolation" ON "pharmacy_returns"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "pharmacy_return_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pharmacy_return_items_tenant_isolation" ON "pharmacy_return_items"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "pharmacy_cash_closures" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pharmacy_cash_closures_tenant_isolation" ON "pharmacy_cash_closures"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "pharmacy_stock_movements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pharmacy_stock_movements_tenant_isolation" ON "pharmacy_stock_movements"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- =============================================================================
-- sync_outbox trigger — A12 hibrit çift-yön senkron (#552 offline POS gözeti).
-- =============================================================================
CREATE TRIGGER pharmacy_products_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON pharmacy_products
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('pharmacy_product');
CREATE TRIGGER pharmacy_batches_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON pharmacy_batches
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('pharmacy_batch');
CREATE TRIGGER pharmacy_sales_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON pharmacy_sales
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('pharmacy_sale');
CREATE TRIGGER pharmacy_sale_items_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON pharmacy_sale_items
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('pharmacy_sale_item');
CREATE TRIGGER pharmacy_returns_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON pharmacy_returns
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('pharmacy_return');
CREATE TRIGGER pharmacy_return_items_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON pharmacy_return_items
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('pharmacy_return_item');
CREATE TRIGGER pharmacy_cash_closures_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON pharmacy_cash_closures
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('pharmacy_cash_closure');
CREATE TRIGGER pharmacy_stock_movements_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON pharmacy_stock_movements
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('pharmacy_stock_movement');

-- =============================================================================
-- airmed_app role GRANT. Rol yoksa atla (fresh DB / CI guard, 42704'ü önle).
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "pharmacy_products", "pharmacy_batches", "pharmacy_sales", "pharmacy_sale_items", "pharmacy_returns", "pharmacy_return_items", "pharmacy_cash_closures", "pharmacy_stock_movements" TO airmed_app';
  END IF;
END$$;
