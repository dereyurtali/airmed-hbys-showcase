-- R1 (#723) — Kalıcı klinik problem + ilaç listesi (EHR problem list).
-- Hepsi tenant_id + RLS + sync_outbox (A12 hibrit senkron). createdById raw FK
-- (User modeline Prisma relation eklemeden; pharmacy_stock_movements deseni).

-- =============================================================================
-- Tablolar
-- =============================================================================
CREATE TABLE "patient_problems" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "icd10" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "onset_date" DATE,
    "resolved_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "patient_problems_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "patient_medications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "dose" VARCHAR(80),
    "frequency" VARCHAR(80),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "started_at" DATE,
    "stopped_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "patient_medications_pkey" PRIMARY KEY ("id")
);

-- =============================================================================
-- İndeksler
-- =============================================================================
CREATE INDEX "patient_problems_tenant_id_patient_id_status_deleted_at_idx"
    ON "patient_problems"("tenant_id", "patient_id", "status", "deleted_at");
CREATE INDEX "patient_medications_tenant_id_patient_id_status_deleted_at_idx"
    ON "patient_medications"("tenant_id", "patient_id", "status", "deleted_at");

-- =============================================================================
-- Foreign keys
-- =============================================================================
ALTER TABLE "patient_problems" ADD CONSTRAINT "patient_problems_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_problems" ADD CONSTRAINT "patient_problems_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_problems" ADD CONSTRAINT "patient_problems_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- RLS — kanonik pattern (app.current_tenant_id, NULLIF formu).
-- =============================================================================
ALTER TABLE "patient_problems" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "patient_problems_tenant_isolation" ON "patient_problems"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "patient_medications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "patient_medications_tenant_isolation" ON "patient_medications"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- =============================================================================
-- sync_outbox trigger — A12 hibrit çift-yön senkron.
-- =============================================================================
CREATE TRIGGER patient_problems_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON "patient_problems"
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('patient_problem');
CREATE TRIGGER patient_medications_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON "patient_medications"
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('patient_medication');
