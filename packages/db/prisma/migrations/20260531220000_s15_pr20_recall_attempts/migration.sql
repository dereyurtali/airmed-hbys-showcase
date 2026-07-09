-- S15-PR20 — Recall (post-op takip) attempt log.

CREATE TYPE "RecallAttemptMethod" AS ENUM ('sms', 'phone', 'email');
CREATE TYPE "RecallAttemptResult" AS ENUM (
  'reached',
  'no_answer',
  'rescheduled',
  'voicemail',
  'wrong_number'
);

CREATE TABLE "recall_attempts" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "appointment_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "method" "RecallAttemptMethod" NOT NULL,
  "result" "RecallAttemptResult" NOT NULL,
  "notes" VARCHAR(500),
  "attempted_by_id" UUID NOT NULL,
  "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "recall_attempts_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION,
  CONSTRAINT "recall_attempts_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE,
  CONSTRAINT "recall_attempts_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE NO ACTION,
  CONSTRAINT "recall_attempts_attempted_by_id_fkey"
    FOREIGN KEY ("attempted_by_id") REFERENCES "users"("id") ON DELETE NO ACTION
);

CREATE INDEX "recall_attempts_tenant_appointment_idx"
  ON "recall_attempts" ("tenant_id", "appointment_id", "attempted_at" DESC);

CREATE INDEX "recall_attempts_tenant_patient_idx"
  ON "recall_attempts" ("tenant_id", "patient_id", "attempted_at" DESC);

ALTER TABLE "recall_attempts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recall_attempts_tenant_isolation" ON "recall_attempts"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
