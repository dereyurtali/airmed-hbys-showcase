-- B1 PR 1 — Surgery extension: yapısal alanlar (eyeSide, anesthesiaType,
-- surgeonRole). Mevcut EyeSide enum (od/os/ou) ve AnesthesiaType (topical/
-- local/none) reuse edildi; AnesthesiaType'a B1 için general + periocular
-- eklendi.

-- PG 12+ ALTER TYPE ADD VALUE transaction-safe. Pilot deployment Postgres 16.
ALTER TYPE "AnesthesiaType" ADD VALUE IF NOT EXISTS 'general';
ALTER TYPE "AnesthesiaType" ADD VALUE IF NOT EXISTS 'periocular';

CREATE TYPE "SurgeonRole" AS ENUM ('VISITING', 'LOCAL', 'REFERRAL');

ALTER TABLE "surgeries"
  ADD COLUMN "anesthesia_type" "AnesthesiaType",
  ADD COLUMN "eye_side" "EyeSide",
  ADD COLUMN "surgeon_role" "SurgeonRole";
