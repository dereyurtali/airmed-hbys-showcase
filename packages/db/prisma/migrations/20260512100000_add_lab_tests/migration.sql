-- B2 LabTest (Tetkik Merkezi) — model + enums + RLS

-- CreateEnum
CREATE TYPE "LabTestSource" AS ENUM ('internal', 'external');

-- CreateEnum
CREATE TYPE "LabTestType" AS ENUM (
  'visual_field',
  'oct_macula',
  'oct_optic_nerve',
  'topography',
  'pachymetry',
  'biometry',
  'fluorescein_angiography',
  'iop_curve',
  'blood_test',
  'ekg',
  'chest_xray',
  'urinalysis',
  'other'
);

-- CreateTable
CREATE TABLE "lab_tests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "source" "LabTestSource" NOT NULL,
    "test_type" "LabTestType" NOT NULL,
    "performed_at" TIMESTAMP(3) NOT NULL,
    "results" JSONB NOT NULL DEFAULT '{}',
    "notes" VARCHAR(2000),
    "external_lab" VARCHAR(200),
    "file_key" VARCHAR(255),
    "file_name" VARCHAR(255),
    "file_mime_type" VARCHAR(100),
    "file_size_bytes" INTEGER,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_tests_tenant_id_patient_id_performed_at_idx"
  ON "lab_tests"("tenant_id", "patient_id", "performed_at" DESC);
CREATE INDEX "lab_tests_tenant_id_test_type_performed_at_idx"
  ON "lab_tests"("tenant_id", "test_type", "performed_at" DESC);
CREATE INDEX "lab_tests_tenant_id_deleted_at_idx"
  ON "lab_tests"("tenant_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "lab_tests"
  ADD CONSTRAINT "lab_tests_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_tests"
  ADD CONSTRAINT "lab_tests_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_tests"
  ADD CONSTRAINT "lab_tests_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (NULL-safe pattern: patient_photos / surgeries / measurements ile aynı)
ALTER TABLE "lab_tests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_tests" FORCE ROW LEVEL SECURITY;

CREATE POLICY "lab_tests_tenant_isolation" ON "lab_tests"
  USING (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );
