-- E3 Eczane / Optikçi — Supplier + Prescription + RLS

CREATE TYPE "SupplierCategory" AS ENUM ('pharmacy', 'optic', 'other');
CREATE TYPE "PrescriptionType" AS ENUM ('drug', 'eyewear');

CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" "SupplierCategory" NOT NULL,
    "contact_phone" VARCHAR(20),
    "contact_email" VARCHAR(255),
    "address" VARCHAR(500),
    "notes" VARCHAR(1000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "suppliers_tenant_id_category_is_active_deleted_at_idx"
  ON "suppliers"("tenant_id", "category", "is_active", "deleted_at");

ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "type" "PrescriptionType" NOT NULL,
    "supplier_id" UUID,
    "items" JSONB NOT NULL DEFAULT '[]',
    "notes" VARCHAR(2000),
    "sent_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prescriptions_tenant_id_patient_id_created_at_idx"
  ON "prescriptions"("tenant_id", "patient_id", "created_at" DESC);
CREATE INDEX "prescriptions_tenant_id_type_sent_at_idx"
  ON "prescriptions"("tenant_id", "type", "sent_at");
CREATE INDEX "prescriptions_tenant_id_deleted_at_idx"
  ON "prescriptions"("tenant_id", "deleted_at");

ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "suppliers_tenant_isolation" ON "suppliers"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "prescriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prescriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "prescriptions_tenant_isolation" ON "prescriptions"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
