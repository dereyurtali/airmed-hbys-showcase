-- S15-PR16 — Surgery refusal reason (yapısal vazgeçme akışı).

ALTER TYPE "SurgeryStatus" ADD VALUE IF NOT EXISTS 'refused';

CREATE TYPE "SurgeryRefusalReason" AS ENUM (
  'financial',
  'medical_concern',
  'family',
  'second_opinion',
  'other'
);

ALTER TABLE "surgeries"
  ADD COLUMN "refusal_reason" "SurgeryRefusalReason",
  ADD COLUMN "refusal_notes" VARCHAR(500),
  ADD COLUMN "refused_at" TIMESTAMP(3);

CREATE INDEX "surgeries_tenant_refusal_idx"
  ON "surgeries" ("tenant_id", "refusal_reason")
  WHERE "refusal_reason" IS NOT NULL;
