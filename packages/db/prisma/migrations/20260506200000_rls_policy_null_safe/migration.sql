-- F1 follow-up: tenant_isolation policies must NOT crash when current_setting
-- returns the empty string (its default for an unset GUC inside a fresh
-- transaction). Casting `''::uuid` raises 22P02. Postgres does not guarantee
-- short-circuit evaluation of AND in policies, so we use NULLIF to convert
-- empty string to NULL before the uuid cast — a NULL comparison evaluates
-- to NULL, which RLS treats as "no match" without raising.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users',
    'roles',
    'user_roles',
    'patients',
    'doctors',
    'doctor_availabilities',
    'appointments',
    'examinations',
    'surgeries',
    'measurements',
    'refresh_tokens',
    'audit_logs'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (
          tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
        WITH CHECK (
          tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        );
    $f$, t);
  END LOOP;
END
$$;
