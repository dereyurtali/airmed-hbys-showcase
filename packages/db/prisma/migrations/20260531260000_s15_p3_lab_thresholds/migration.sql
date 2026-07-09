-- S15-P3 — Lab abnormal threshold (klinik özel referans aralıkları).

CREATE TYPE "LabThresholdSex" AS ENUM ('any', 'male', 'female');

CREATE TABLE "lab_abnormal_thresholds" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "test_code" VARCHAR(60) NOT NULL,
  "sex" "LabThresholdSex" NOT NULL DEFAULT 'any',
  "age_min" INT,
  "age_max" INT,
  "low_limit" DECIMAL(12, 4),
  "high_limit" DECIMAL(12, 4),
  "unit" VARCHAR(30),
  "notes" VARCHAR(500),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "lab_abnormal_thresholds_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION,
  CONSTRAINT "lab_abnormal_thresholds_unique"
    UNIQUE ("tenant_id", "test_code", "sex", "age_min", "age_max")
);

CREATE INDEX "lab_abnormal_thresholds_tenant_test_idx"
  ON "lab_abnormal_thresholds" ("tenant_id", "test_code", "is_active");

ALTER TABLE "lab_abnormal_thresholds" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab_abnormal_thresholds_tenant_isolation" ON "lab_abnormal_thresholds"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
