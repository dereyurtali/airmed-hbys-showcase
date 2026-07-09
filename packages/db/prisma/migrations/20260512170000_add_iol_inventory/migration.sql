-- C1 IOL Inventory — IolModel + IolLot + IolStockMovement + IolMovementType

-- CreateEnum
CREATE TYPE "IolMovementType" AS ENUM ('receive', 'consume', 'adjust', 'return', 'expire');

-- CreateTable iol_models
CREATE TABLE "iol_models" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "brand" VARCHAR(100) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "iol_models_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "iol_models_tenant_id_brand_model_key"
  ON "iol_models"("tenant_id", "brand", "model");
CREATE INDEX "iol_models_tenant_id_is_active_deleted_at_idx"
  ON "iol_models"("tenant_id", "is_active", "deleted_at");

ALTER TABLE "iol_models"
  ADD CONSTRAINT "iol_models_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable iol_lots
CREATE TABLE "iol_lots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "lot_number" VARCHAR(100) NOT NULL,
    "power" DECIMAL(5,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "expires_at" DATE NOT NULL,
    "supplier" VARCHAR(150),
    "notes" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "iol_lots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "iol_lots_tenant_id_model_id_lot_number_power_key"
  ON "iol_lots"("tenant_id", "model_id", "lot_number", "power");
CREATE INDEX "iol_lots_tenant_id_expires_at_idx"
  ON "iol_lots"("tenant_id", "expires_at");
CREATE INDEX "iol_lots_tenant_id_deleted_at_idx"
  ON "iol_lots"("tenant_id", "deleted_at");
CREATE INDEX "iol_lots_tenant_id_model_id_deleted_at_idx"
  ON "iol_lots"("tenant_id", "model_id", "deleted_at");

ALTER TABLE "iol_lots"
  ADD CONSTRAINT "iol_lots_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "iol_lots"
  ADD CONSTRAINT "iol_lots_model_id_fkey"
  FOREIGN KEY ("model_id") REFERENCES "iol_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "iol_lots"
  ADD CONSTRAINT "iol_lots_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable iol_stock_movements
CREATE TABLE "iol_stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "type" "IolMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "surgery_id" UUID,
    "notes" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "iol_stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "iol_stock_movements_tenant_id_lot_id_created_at_idx"
  ON "iol_stock_movements"("tenant_id", "lot_id", "created_at" DESC);

ALTER TABLE "iol_stock_movements"
  ADD CONSTRAINT "iol_stock_movements_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "iol_stock_movements"
  ADD CONSTRAINT "iol_stock_movements_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "iol_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "iol_stock_movements"
  ADD CONSTRAINT "iol_stock_movements_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (NULL-safe pattern, lab_tests/patient_photos ile aynı)
ALTER TABLE "iol_models" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "iol_models" FORCE ROW LEVEL SECURITY;
CREATE POLICY "iol_models_tenant_isolation" ON "iol_models"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "iol_lots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "iol_lots" FORCE ROW LEVEL SECURITY;
CREATE POLICY "iol_lots_tenant_isolation" ON "iol_lots"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "iol_stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "iol_stock_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY "iol_stock_movements_tenant_isolation" ON "iol_stock_movements"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
