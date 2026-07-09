-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM (
  'instagram',
  'telegram',
  'whatsapp',
  'doctor_referral',
  'returning_patient',
  'optic_partner',
  'corporate_contract',
  'field_rep',
  'walk_in',
  'other'
);

-- AlterTable
ALTER TABLE "patients"
  ADD COLUMN "lead_source" "LeadSource",
  ADD COLUMN "lead_source_note" VARCHAR(255);

-- CreateIndex
CREATE INDEX "patients_lead_source_created_idx"
  ON "patients" ("tenant_id", "lead_source", "created_at");
