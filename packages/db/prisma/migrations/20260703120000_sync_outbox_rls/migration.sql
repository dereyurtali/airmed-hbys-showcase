-- #917 — sync_outbox RLS. 20260524190530_add_sync_outbox tabloyu + tenant_id
-- ekledi ama 74 RLS'li tablodan farklı olarak policy kurmadı. payload jsonb
-- hasta adı/MRN/muayene notu içerir. Bugün yalnız admin(BYPASSRLS) client + elle
-- tenant filtresiyle erişiliyor (izole), ama biri tenant-filtresiz sorgu eklerse
-- cross-tenant sızar — diğer 74 tabloda RLS bunu otomatik yakalardı. Asimetri:
-- sync_conflicts aynı erişim modelinde ama RLS'i VAR (20260526023641). Aynı
-- deseni sync_outbox'a uygula.
--
-- Not: airmed_bg (BYPASSRLS, #916) sync worker'ında policy'yi bypass eder →
-- mevcut kullanım kırılmaz. sync_outbox trigger'ı airmed_app INSERT'i sırasında
-- app.current_tenant_id GUC set iken çalışır → WITH CHECK karşılanır.
-- tenant_id NULL (platform-level) satırlar yalnız BYPASSRLS ile görünür.

ALTER TABLE "sync_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_outbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY "sync_outbox_tenant_isolation" ON "sync_outbox"
  USING (
    "tenant_id" IS NOT NULL
    AND "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" IS NOT NULL
    AND "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );
