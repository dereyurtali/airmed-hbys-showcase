-- S15-PR10 — Hemşire "Acting on Behalf" oturumu + AuditLog co-sign trail.
-- JCI akreditasyon + KVKK uyumu için server-side session yönetimi (User.flags
-- hack'i yerine). Anlık revoke (revokedAt) + multi-doctor shift overlapping.

CREATE TABLE "nurse_assistance_sessions" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"   UUID NOT NULL,
  "nurse_user_id"  UUID NOT NULL,
  "doctor_user_id" UUID NOT NULL,
  "started_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at"    TIMESTAMP(3),
  "revoked_at"  TIMESTAMP(3),
  "revoked_by"  UUID,
  "reason"      VARCHAR(500),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "nurse_assistance_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "nurse_assistance_sessions_tenant_nurse_ended_idx"
  ON "nurse_assistance_sessions" ("tenant_id", "nurse_user_id", "ended_at");

CREATE INDEX "nurse_assistance_sessions_tenant_doctor_ended_idx"
  ON "nurse_assistance_sessions" ("tenant_id", "doctor_user_id", "ended_at");

CREATE INDEX "nurse_sessions_active_lookup"
  ON "nurse_assistance_sessions" ("tenant_id", "nurse_user_id", "ended_at", "revoked_at");

ALTER TABLE "nurse_assistance_sessions"
  ADD CONSTRAINT "nurse_sessions_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "nurse_assistance_sessions"
  ADD CONSTRAINT "nurse_sessions_nurse_fkey"
  FOREIGN KEY ("nurse_user_id") REFERENCES "users" ("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "nurse_assistance_sessions"
  ADD CONSTRAINT "nurse_sessions_doctor_fkey"
  FOREIGN KEY ("doctor_user_id") REFERENCES "users" ("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- RLS: tenant isolation (mevcut pattern)
ALTER TABLE "nurse_assistance_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nurse_assistance_sessions_tenant_isolation"
  ON "nurse_assistance_sessions"
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

-- Sync outbox trigger (A12 pattern)
CREATE TRIGGER "nurse_assistance_sessions_sync_outbox"
  AFTER INSERT OR UPDATE OR DELETE ON "nurse_assistance_sessions"
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('nurse_assistance_session');

-- AuditLog'a co-sign trail field'ları
ALTER TABLE "audit_logs"
  ADD COLUMN "on_behalf_of_user_id" UUID,
  ADD COLUMN "nurse_session_id"     UUID;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_on_behalf_of_fkey"
  FOREIGN KEY ("on_behalf_of_user_id") REFERENCES "users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_nurse_session_fkey"
  FOREIGN KEY ("nurse_session_id") REFERENCES "nurse_assistance_sessions" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Co-sign raporu için index (doktorun adına yapılan işlemler).
CREATE INDEX "audit_logs_on_behalf_of_idx"
  ON "audit_logs" ("tenant_id", "on_behalf_of_user_id", "created_at");
