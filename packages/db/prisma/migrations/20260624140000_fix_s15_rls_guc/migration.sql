-- #665 — S15 tablolarında RLS policy YANLIŞ GUC kullanıyordu
-- (current_setting('app.tenant_id') — runtime hiç set etmez; kanonik ad
-- 'app.current_tenant_id'). Sonuç: airmed_app rolü için deny-all (fail-CLOSED;
-- sızıntı DEĞİL ama özellik aktifleşince satır görünmez). v0.4 kanonik pattern'e
-- hizalanır: NULLIF(...) + WITH CHECK (INSERT/UPDATE de tenant'a bağlanır).

DROP POLICY IF EXISTS "patient_message_threads_tenant_isolation" ON "patient_message_threads";
CREATE POLICY "patient_message_threads_tenant_isolation" ON "patient_message_threads"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS "patient_thread_messages_tenant_isolation" ON "patient_thread_messages";
CREATE POLICY "patient_thread_messages_tenant_isolation" ON "patient_thread_messages"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS "recall_attempts_tenant_isolation" ON "recall_attempts";
CREATE POLICY "recall_attempts_tenant_isolation" ON "recall_attempts"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS "lab_abnormal_thresholds_tenant_isolation" ON "lab_abnormal_thresholds";
CREATE POLICY "lab_abnormal_thresholds_tenant_isolation" ON "lab_abnormal_thresholds"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS "surgical_kits_tenant_isolation" ON "surgical_kits";
CREATE POLICY "surgical_kits_tenant_isolation" ON "surgical_kits"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS "surgical_kit_components_tenant_isolation" ON "surgical_kit_components";
CREATE POLICY "surgical_kit_components_tenant_isolation" ON "surgical_kit_components"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
