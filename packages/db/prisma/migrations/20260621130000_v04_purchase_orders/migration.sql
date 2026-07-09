-- v0.4 #548 — Satın Alma Siparişi (Purchase Order) veritabanı yapısı.
--
-- Generic PO: hem klinik (IOL/sarf) hem eczane (perakende) siparişleri AYNI
-- yapıyı kullanır; "domain" ile ayrılır (plan §3.6). Tedarikçi ortak `suppliers`
-- tablosu. Eşik üstü tutar → finans onay iş akışı (#549). Görev ayrılığı:
-- oluşturan (created_by_id) ≠ onaylayan (approved_by_id) — service guard #549.
--
-- Bu migration YALNIZ DB yapısı (#548). Tüm tablolar: tenant_id + RLS + sync_outbox.

-- =============================================================================
-- ENUMS
-- =============================================================================
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('draft', 'submitted', 'pending_approval', 'approved', 'received', 'cancelled');
CREATE TYPE "PurchaseOrderDomain" AS ENUM ('clinic', 'pharmacy');

-- =============================================================================
-- TABLO: purchase_orders (sipariş başlığı)
-- =============================================================================
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_no" VARCHAR(30) NOT NULL,
    "supplier_id" UUID NOT NULL,
    "domain" "PurchaseOrderDomain" NOT NULL DEFAULT 'clinic',
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'draft',
    "currency" "Currency" NOT NULL DEFAULT 'TJS',
    "total_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "approval_threshold" DECIMAL(10,2),
    "notes" VARCHAR(2000),
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_orders_tenant_id_order_no_key" ON "purchase_orders"("tenant_id", "order_no");
CREATE INDEX "purchase_orders_tenant_id_domain_status_deleted_at_idx" ON "purchase_orders"("tenant_id", "domain", "status", "deleted_at");
CREATE INDEX "purchase_orders_tenant_id_supplier_id_created_at_idx" ON "purchase_orders"("tenant_id", "supplier_id", "created_at" DESC);

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_id_fkey"
    FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- TABLO: purchase_order_items (sipariş kalemleri)
-- =============================================================================
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "reference_type" VARCHAR(40),
    "reference_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_order_items_tenant_id_purchase_order_id_idx" ON "purchase_order_items"("tenant_id", "purchase_order_id");

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey"
    FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS — kanonik pattern (app.current_tenant_id, NULLIF formu). Request-scoped
-- transaction bu GUC'u set eder (prisma.service.runWithTenant).
-- =============================================================================
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchase_orders_tenant_isolation" ON "purchase_orders"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "purchase_order_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchase_order_items_tenant_isolation" ON "purchase_order_items"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- =============================================================================
-- sync_outbox trigger — A12 hibrit çift-yön senkron (invoices/payments deseni).
-- =============================================================================
CREATE TRIGGER purchase_orders_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('purchase_order');
CREATE TRIGGER purchase_order_items_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('purchase_order_item');

-- =============================================================================
-- airmed_app role'üne GRANT. Rol yoksa atla (fresh DB / CI'da migrate, airmed_app
-- oluşturulmadan önce çalışabilir → 42704'ü önle). s11a/patient_photos guard'ı.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_orders", "purchase_order_items" TO airmed_app';
  END IF;
END$$;
