-- S15-PR15b — Refund 2-aşama approval gate.
-- Mevcut satırlar: approvalStatus='approved', requestedById=approvedById,
-- approvedAt=createdAt. Bu sayede legacy iadeler bozulmadan yaşamaya devam eder.

CREATE TYPE "RefundApprovalStatus" AS ENUM (
  'pending',
  'approved',
  'rejected',
  'reversed'
);

ALTER TABLE "refunds"
  ADD COLUMN "requested_by_id" UUID,
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "approval_status" "RefundApprovalStatus" NOT NULL DEFAULT 'approved',
  ADD COLUMN "rejection_reason" VARCHAR(500),
  ADD COLUMN "reversed_at" TIMESTAMP(3),
  ADD COLUMN "reversed_by_id" UUID;

-- Legacy backfill: tüm mevcut iadeler 'approved' kabul edilir (önceden zaten
-- tek-aşama akıştı). requested_by = approved_by (talep eden = onaylayan).
UPDATE "refunds"
SET
  "requested_by_id" = "approved_by_id",
  "approved_at" = "created_at"
WHERE "requested_by_id" IS NULL;

-- Şimdi requested_by_id NOT NULL.
ALTER TABLE "refunds"
  ALTER COLUMN "requested_by_id" SET NOT NULL;

-- approved_by_id yeni şemada nullable (pending durumunda null).
ALTER TABLE "refunds"
  ALTER COLUMN "approved_by_id" DROP NOT NULL;

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE NO ACTION,
  ADD CONSTRAINT "refunds_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE NO ACTION;

CREATE INDEX "refunds_tenant_approval_status_idx"
  ON "refunds" ("tenant_id", "approval_status");
