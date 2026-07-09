-- A10 dış API — ApiKey model.
--
-- Tenant-scoped API anahtarları. Anahtar üretim akışı service'de:
--   1. crypto.randomBytes(32) → 64-char hex plaintext
--   2. format "ak_{tenantSlug}_{plaintext}" → kullanıcıya bir kez gösterilir
--   3. SHA-256 hash DB'ye (key_hash); raw plaintext SAKLANMAZ
--   4. prefix (ilk 12 char) UI'da identifier olarak gösterilir
--
-- Scopes: string[] — runtime kontrolü ApiKeyService'de:
--   patient:read, patient:create, patient:update,
--   appointment:read, appointment:create, appointment:cancel,
--   availability:read
--
-- key_hash @unique: aynı SHA-256 hash iki kayıtta olamaz (cosmic ray ihtimali).
-- prefix @index yok — UI listede zaten tenant_id ile sorgulanır, ek index gereksiz.
--
-- onDelete: createdBy User soft-deleted olabilir → SET NULL (anahtar yaşar,
-- audit için kim oluşturdu bilgisi kaybolur). Tenant hard-delete = NO ACTION
-- (cascade istemiyoruz, klinik silme manuel platform işlemi).

CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "key_hash" VARCHAR(64) NOT NULL,
    "prefix" VARCHAR(20) NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rate_limit" INTEGER NOT NULL DEFAULT 1000,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE INDEX "api_keys_tenant_id_is_active_idx" ON "api_keys"("tenant_id", "is_active");
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");

ALTER TABLE "api_keys"
    ADD CONSTRAINT "api_keys_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "api_keys"
    ADD CONSTRAINT "api_keys_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Multi-tenant RLS — null-safe pattern (bkz. 20260506200000_rls_policy_null_safe).
-- ApiKey doğrulama akışı (key_hash lookup) tenant context HENÜZ set EDİLMEDEN
-- çalışır; bu lookup PrismaService.admin (RLS bypass) ile yapılmalıdır. Tenant
-- admin CRUD ise her zaman scoped (RLS açık) — bu ayrım ApiKeyService'de zorlanır.
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "api_keys"
    USING (
      tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
    WITH CHECK (
      tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );
