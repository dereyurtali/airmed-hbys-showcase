-- B5 Procedures (IVT, YAG, lazer, SLT, cross-linking, minor) — Surgery'den ayrı.

-- CreateEnum
CREATE TYPE "ProcedureType" AS ENUM (
  'intravitreal_injection',
  'yag_capsulotomy',
  'argon_laser',
  'retina_laser_prp',
  'slt',
  'cross_linking',
  'minor'
);

CREATE TYPE "ProcedureStatus" AS ENUM ('planned', 'performed', 'cancelled');

CREATE TYPE "EyeSide" AS ENUM ('od', 'os', 'ou');

CREATE TYPE "AnesthesiaType" AS ENUM ('topical', 'local', 'none');

-- CreateTable
CREATE TABLE "procedures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "appointment_id" UUID,
    "follow_up_appointment_id" UUID,
    "type" "ProcedureType" NOT NULL,
    "status" "ProcedureStatus" NOT NULL DEFAULT 'planned',
    "eye_side" "EyeSide" NOT NULL,
    "anesthesia" "AnesthesiaType" NOT NULL DEFAULT 'topical',
    "drug_used" VARCHAR(150),
    "drug_dose" VARCHAR(50),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "findings" TEXT,
    "complications" TEXT,
    "notes" TEXT,
    "performed_at" TIMESTAMP(3) NOT NULL,
    "post_procedure_control_date" DATE,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "procedures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "procedures_appointment_id_key"
  ON "procedures"("appointment_id");
CREATE UNIQUE INDEX "procedures_follow_up_appointment_id_key"
  ON "procedures"("follow_up_appointment_id");
CREATE INDEX "procedures_tenant_id_patient_id_performed_at_idx"
  ON "procedures"("tenant_id", "patient_id", "performed_at" DESC);
CREATE INDEX "procedures_tenant_id_doctor_id_performed_at_idx"
  ON "procedures"("tenant_id", "doctor_id", "performed_at" DESC);
CREATE INDEX "procedures_tenant_id_type_performed_at_idx"
  ON "procedures"("tenant_id", "type", "performed_at" DESC);
CREATE INDEX "procedures_tenant_id_deleted_at_idx"
  ON "procedures"("tenant_id", "deleted_at");

ALTER TABLE "procedures"
  ADD CONSTRAINT "procedures_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "procedures"
  ADD CONSTRAINT "procedures_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "procedures"
  ADD CONSTRAINT "procedures_doctor_id_fkey"
  FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "procedures"
  ADD CONSTRAINT "procedures_appointment_id_fkey"
  FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "procedures"
  ADD CONSTRAINT "procedures_follow_up_appointment_id_fkey"
  FOREIGN KEY ("follow_up_appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "procedures"
  ADD CONSTRAINT "procedures_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (NULL-safe pattern, IolModel/IolLot ile aynı)
ALTER TABLE "procedures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "procedures" FORCE ROW LEVEL SECURITY;
CREATE POLICY "procedures_tenant_isolation" ON "procedures"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
