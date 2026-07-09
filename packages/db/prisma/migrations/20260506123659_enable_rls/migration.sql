-- F1: Multi-tenant Row Level Security (RLS)
-- Each tenant-scoped table is enabled with FORCE RLS so that even superusers
-- (excluding BYPASSRLS) must satisfy the policy. The application role MUST set
-- app.current_tenant_id session variable per request (TenantInterceptor in #21).
-- Policy: rows visible only when tenant_id = current_setting('app.current_tenant_id')::uuid

-- =============================================================================
-- USERS
-- =============================================================================
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "users";
CREATE POLICY tenant_isolation ON "users"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- ROLES
-- =============================================================================
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "roles";
CREATE POLICY tenant_isolation ON "roles"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- USER_ROLES
-- =============================================================================
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "user_roles";
CREATE POLICY tenant_isolation ON "user_roles"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- PATIENTS
-- =============================================================================
ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "patients";
CREATE POLICY tenant_isolation ON "patients"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- DOCTORS
-- =============================================================================
ALTER TABLE "doctors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctors" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "doctors";
CREATE POLICY tenant_isolation ON "doctors"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- DOCTOR_AVAILABILITIES
-- =============================================================================
ALTER TABLE "doctor_availabilities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_availabilities" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "doctor_availabilities";
CREATE POLICY tenant_isolation ON "doctor_availabilities"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- APPOINTMENTS
-- =============================================================================
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "appointments";
CREATE POLICY tenant_isolation ON "appointments"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- EXAMINATIONS
-- =============================================================================
ALTER TABLE "examinations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "examinations" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "examinations";
CREATE POLICY tenant_isolation ON "examinations"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- SURGERIES
-- =============================================================================
ALTER TABLE "surgeries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "surgeries" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "surgeries";
CREATE POLICY tenant_isolation ON "surgeries"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- MEASUREMENTS
-- =============================================================================
ALTER TABLE "measurements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "measurements" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "measurements";
CREATE POLICY tenant_isolation ON "measurements"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- REFRESH_TOKENS
-- =============================================================================
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "refresh_tokens";
CREATE POLICY tenant_isolation ON "refresh_tokens"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =============================================================================
-- AUDIT_LOGS — special: tenant_id NULLABLE for platform actions
-- Klinik users see only their tenant records.
-- Platform admins use a separate DB role (BYPASSRLS, configured in F4 Hf 19);
-- when no tenant context is set, klinik connection sees nothing.
-- =============================================================================
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "audit_logs";
CREATE POLICY tenant_isolation ON "audit_logs"
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

-- =============================================================================
-- TENANTS, PLATFORM_ADMINS — NO RLS
-- These are cross-tenant control tables. Tenant table is read by every
-- interceptor (suspend check) so it must be visible without tenant context.
-- Application-level checks (TenantInterceptor in #21) restrict access.
-- =============================================================================
