-- S15-PR23 — AuditLog co-sign onay durumu.

ALTER TABLE "audit_logs"
  ADD COLUMN "cosigned_at" TIMESTAMP(3),
  ADD COLUMN "cosigned_by_id" UUID,
  ADD COLUMN "cosign_rejected" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_cosigned_by_id_fkey"
  FOREIGN KEY ("cosigned_by_id") REFERENCES "users"("id") ON DELETE NO ACTION;

CREATE INDEX "audit_logs_tenant_pending_cosign_idx"
  ON "audit_logs" ("tenant_id", "on_behalf_of_user_id", "cosigned_at");
