-- D1 Mesajlaşma RLS — 20260524214317_add_messaging_d1 migration'ında 3 tabloya
-- (message_templates, message_triggers, message_deliveries) RLS policy
-- eklenmemiş; bu açık, cross-tenant okuma/yazmaya kapı açıyor. Mevcut RLS
-- pattern'i (suppliers/prescriptions, NULLIF current_setting) ile aynı.

ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "message_templates_tenant_isolation" ON "message_templates"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "message_triggers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_triggers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "message_triggers_tenant_isolation" ON "message_triggers"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "message_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "message_deliveries_tenant_isolation" ON "message_deliveries"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
