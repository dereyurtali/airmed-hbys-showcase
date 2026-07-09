-- C3: RLS for patient_photos (tenant isolation, same pattern as F1).
ALTER TABLE "patient_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_photos" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "patient_photos";
CREATE POLICY tenant_isolation ON "patient_photos"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Grant the application role (airmed_app) usage on the new table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "patient_photos" TO airmed_app';
  END IF;
END$$;
