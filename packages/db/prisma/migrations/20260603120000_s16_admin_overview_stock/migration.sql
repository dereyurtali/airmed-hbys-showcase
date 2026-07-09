-- S16 — Yönetici "Genel Bakış": stok eşikleri + sarf malzeme (consumable).

-- IOL modeli: lens tipi sınıflandırma (Lens İhtiyacı paneli gruplaması) +
-- yeniden-sipariş eşiği (Kritik Stok "Düşük" uyarısı).
ALTER TABLE "iol_models"
  ADD COLUMN "lens_type" VARCHAR(30) NOT NULL DEFAULT 'monofocal',
  ADD COLUMN "min_qty" INTEGER NOT NULL DEFAULT 0;

-- Sarf malzeme stoğu (IOL-dışı; keratom bıçağı, viskoelastik, sütur vb.).
CREATE TABLE "consumables" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "category" VARCHAR(60),
  "unit" VARCHAR(30),
  "available_qty" INTEGER NOT NULL DEFAULT 0,
  "min_qty" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "consumables_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION,
  CONSTRAINT "consumables_tenant_name_unique" UNIQUE ("tenant_id", "name")
);

CREATE INDEX "consumables_tenant_active_idx"
  ON "consumables" ("tenant_id", "is_active", "deleted_at");

-- RLS — kanonik pattern (app.current_tenant_id, NULLIF formu). Request-scoped
-- transaction bu GUC'u set eder (prisma.service.runWithTenant).
ALTER TABLE "consumables" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consumables_tenant_isolation" ON "consumables"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
