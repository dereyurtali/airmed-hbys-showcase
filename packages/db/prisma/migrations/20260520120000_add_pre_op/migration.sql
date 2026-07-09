-- B3 Pre-op (1-1 Surgery) — checklist JSONB, vitals JSONB, IOL lens rezervasyonu

-- CreateTable pre_ops
CREATE TABLE "pre_ops" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "surgery_id" UUID NOT NULL,
    "vital_signs" JSONB NOT NULL DEFAULT '{}',
    "dilatation_at" TIMESTAMP(3),
    "checklist_items" JSONB NOT NULL DEFAULT '[]',
    "anesthesia_notes" VARCHAR(2000),
    "lens_iol_lot_id" UUID,
    "lens_reserved_at" TIMESTAMP(3),
    "ready_for_surgery" BOOLEAN NOT NULL DEFAULT false,
    "ready_at" TIMESTAMP(3),
    "ready_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "pre_ops_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pre_ops_surgery_id_key" ON "pre_ops"("surgery_id");
CREATE INDEX "pre_ops_tenant_id_ready_for_surgery_idx"
  ON "pre_ops"("tenant_id", "ready_for_surgery");
CREATE INDEX "pre_ops_tenant_id_lens_iol_lot_id_idx"
  ON "pre_ops"("tenant_id", "lens_iol_lot_id");

ALTER TABLE "pre_ops"
  ADD CONSTRAINT "pre_ops_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pre_ops"
  ADD CONSTRAINT "pre_ops_surgery_id_fkey"
  FOREIGN KEY ("surgery_id") REFERENCES "surgeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pre_ops"
  ADD CONSTRAINT "pre_ops_lens_iol_lot_id_fkey"
  FOREIGN KEY ("lens_iol_lot_id") REFERENCES "iol_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pre_ops"
  ADD CONSTRAINT "pre_ops_ready_by_id_fkey"
  FOREIGN KEY ("ready_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (NULL-safe, iol_lots / lab_tests / patient_photos pattern)
ALTER TABLE "pre_ops" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pre_ops" FORCE ROW LEVEL SECURITY;
CREATE POLICY "pre_ops_tenant_isolation" ON "pre_ops"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
