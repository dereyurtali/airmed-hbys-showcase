-- #958 — api_keys fail-open RLS'i strict tenant isolation'a daralt.
--
-- 20260512090000_a10_api_keys_rls_relax policy'si (tenant_isolation_or_lookup)
-- GUC NULL iken TÜM satırları SELECT'e açıyordu (auth lookup için gerekliydi:
-- tenant belirlenmeden key_hash lookup). Bu 72 RLS'li tablonun tekil fail-open
-- istisnasıydı → GUC'suz bir bağlamdan (yanlış client kullanımı) yapılan geniş
-- sorgu cross-tenant tüm API key'leri görebilirdi.
--
-- #958'de auth lookup airmed_bg (BYPASSRLS, #916) admin client'ına taşındı
-- (api-key-auth.service). Artık fail-open'a gerek yok → policy strict tenant
-- isolation'a daraltılır (GUC yoksa 0 satır = FAIL-CLOSED). BYPASSRLS rolleri
-- (airmed_bg + superuser fallback) policy'yi zaten bypass ettiği için auth lookup
-- kırılmaz; admin CRUD (prisma.scoped, GUC set) own-tenant satırları görür.
-- WITH CHECK aynı kalır (cross-tenant insert engellenir, defense in depth).
DROP POLICY IF EXISTS tenant_isolation_or_lookup ON "api_keys";
CREATE POLICY tenant_isolation ON "api_keys"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
