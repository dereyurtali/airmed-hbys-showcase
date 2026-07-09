-- A10 PR2 — ApiKey RLS policy gevşetmesi.
--
-- Auth lookup (api_key_hash → tenantId) tenant context AÇILMADAN çalışmalı:
-- /api/external/* istekleri öncelikle anahtarı doğrular, ardından tenant
-- context açar. PR1 policy'si `tenant_id = setting::uuid` NULL setting'te
-- 0 satır döndürüyordu → lookup imkansız.
--
-- Yeni policy: NULL setting → tüm satırlar görünür (auth lookup),
-- set edildiğinde yalnız o tenant'ın satırları (admin CRUD).
-- WITH CHECK aynı kalır — INSERT/UPDATE yalnız tenant context set
-- edildiğinde geçer; auth lookup yalnız SELECT yapar, INSERT/UPDATE'ı
-- ApiKeyService.create/update zaten tenant context altında çalıştırır.

DROP POLICY IF EXISTS tenant_isolation ON "api_keys";

CREATE POLICY tenant_isolation_or_lookup ON "api_keys"
    USING (
      NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
      OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
    WITH CHECK (
      tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );
