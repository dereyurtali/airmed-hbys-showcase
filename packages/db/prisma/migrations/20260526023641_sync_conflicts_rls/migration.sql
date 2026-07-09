-- A12 sync_conflicts RLS — 20260524192606_add_sync_conflicts migration'ı
-- tablo + tenant_id (nullable) kolonu eklemiş ama RLS policy kurmamış.
-- Açık: bir klinik admin'in sync conflict listesi diğer kliniklerin event'lerini
-- (içerikte hasta verisi olabilir) görür hâle geliyor.
--
-- tenant_id NULL = platform-level çakışma → app rolüne görünmesin
-- (yalnız admin BYPASSRLS / platform admin UI üzerinden görünür).
-- tenant_id != NULL satırlar yalnız ait olduğu tenant scope'unda görünür.

ALTER TABLE "sync_conflicts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_conflicts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "sync_conflicts_tenant_isolation" ON "sync_conflicts"
  USING (
    "tenant_id" IS NOT NULL
    AND "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" IS NOT NULL
    AND "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );
