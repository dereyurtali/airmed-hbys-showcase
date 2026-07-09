-- E4 patient tags — Postgres array on patients

-- CreateEnum
CREATE TYPE "PatientTagKey" AS ENUM (
  'vip',
  'risk_high',
  'risk_low',
  'follow_up',
  'chronic',
  'no_show_risk',
  'insurance',
  'pediatric',
  'geriatric'
);

-- AlterTable
ALTER TABLE "patients"
  ADD COLUMN "tags" "PatientTagKey"[] NOT NULL DEFAULT ARRAY[]::"PatientTagKey"[];

-- Postgres GIN index for tag membership queries (filter "VIP olanlar" gibi).
CREATE INDEX "patients_tags_gin_idx" ON "patients" USING GIN ("tags");
