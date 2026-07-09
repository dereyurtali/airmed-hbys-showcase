-- S14b — v0.1 archive port: dashboard widget framework, permission matrix,
-- discount approvals, webhook subscription + delivery, ApiKey ipAllowlist,
-- ServiceItem maxDiscountSelf/Approvable cap'leri.
--
-- Tasarım: /Users/alid/.claude/plans/bunlar-n-hepsini-uygun-bir-joyful-melody.md
-- v0.1 kaynak: DNA-Software-Solutions/airmed-hbys-v01-archive (read-only).
--
-- ApiKey + ApiKeyService + ScopesGuard zaten mevcut (apps/api/src/api-key/);
-- bu migration sadece ipAllowlist field'ı ekler ve yeni Webhook altyapısını
-- kurar. Public booking endpoint'leri B4'te external.controller'a eklenecek.

-- =============================================================================
-- 1) ApiKey.ipAllowlist — opsiyonel IP/CIDR allowlist (boş = kısıtsız)
-- =============================================================================

ALTER TABLE "api_keys"
  ADD COLUMN "ip_allowlist" TEXT[] NOT NULL DEFAULT '{}';

-- =============================================================================
-- 2) ServiceItem indirim cap'leri (yüzde — 0..100)
-- =============================================================================

ALTER TABLE "service_items"
  ADD COLUMN "max_discount_self" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "max_discount_approvable" DECIMAL(5,2) NOT NULL DEFAULT 100;

-- =============================================================================
-- 3) DashboardLayout — per tenant + role (+ opsiyonel user override)
-- widgets JSON: [{ key, x, y, w, h, config? }]
-- =============================================================================

CREATE TABLE "dashboard_layouts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "role_key" "RoleKey" NOT NULL,
  "user_id" UUID,
  "widgets" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  CONSTRAINT "dashboard_layouts_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

-- Unique: tenant+role+(NULL user) tek satır; tenant+role+(user) per-user override.
-- PostgreSQL NULL'ı unique için ayrı kabul ediyor → composite ile uyumsuz
-- davranışı önlemek için iki ayrı partial index:
CREATE UNIQUE INDEX "dashboard_layouts_tenant_role_default_uq"
  ON "dashboard_layouts" ("tenant_id", "role_key")
  WHERE "user_id" IS NULL;
CREATE UNIQUE INDEX "dashboard_layouts_tenant_role_user_uq"
  ON "dashboard_layouts" ("tenant_id", "role_key", "user_id")
  WHERE "user_id" IS NOT NULL;
CREATE INDEX "dashboard_layouts_tenant_role_idx"
  ON "dashboard_layouts" ("tenant_id", "role_key");

ALTER TABLE "dashboard_layouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dashboard_layouts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "dashboard_layouts_tenant_isolation" ON "dashboard_layouts"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- =============================================================================
-- 4) PermissionAssignment — rol × resource matrisi (opsiyonel override)
-- =============================================================================

CREATE TABLE "permission_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "role_key" "RoleKey" NOT NULL,
  "resource" VARCHAR(100) NOT NULL,
  "allowed" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  CONSTRAINT "permission_assignments_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "permission_assignments_tenant_role_resource_uq"
    UNIQUE ("tenant_id", "role_key", "resource")
);

CREATE INDEX "permission_assignments_tenant_role_idx"
  ON "permission_assignments" ("tenant_id", "role_key");

ALTER TABLE "permission_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permission_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "permission_assignments_tenant_isolation" ON "permission_assignments"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- =============================================================================
-- 5) DiscountApproval — indirim onay state machine
-- status: pending|approved|rejected (CHECK constraint)
-- invoice_id veya surgery_id en az biri dolu (CHECK)
-- =============================================================================

CREATE TABLE "discount_approvals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "invoice_id" UUID,
  "surgery_id" UUID,
  "requested_by_id" UUID NOT NULL,
  "discount_percent" DECIMAL(5,2) NOT NULL,
  "discount_amount" DECIMAL(12,2) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_note" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  CONSTRAINT "discount_approvals_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected')),
  CONSTRAINT "discount_approvals_target_present_check"
    CHECK ("invoice_id" IS NOT NULL OR "surgery_id" IS NOT NULL),
  CONSTRAINT "discount_approvals_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

-- FK'lar — invoice/surgery silinirse approval kayıtları cascade silinir
ALTER TABLE "discount_approvals"
  ADD CONSTRAINT "discount_approvals_invoice_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "discount_approvals_surgery_fkey"
    FOREIGN KEY ("surgery_id") REFERENCES "surgeries"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "discount_approvals_requested_by_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "users"("id"),
  ADD CONSTRAINT "discount_approvals_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id");

CREATE INDEX "discount_approvals_tenant_status_idx"
  ON "discount_approvals" ("tenant_id", "status", "created_at" DESC);
CREATE INDEX "discount_approvals_tenant_invoice_idx"
  ON "discount_approvals" ("tenant_id", "invoice_id");
CREATE INDEX "discount_approvals_tenant_surgery_idx"
  ON "discount_approvals" ("tenant_id", "surgery_id");
CREATE INDEX "discount_approvals_tenant_requested_by_idx"
  ON "discount_approvals" ("tenant_id", "requested_by_id");

ALTER TABLE "discount_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discount_approvals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "discount_approvals_tenant_isolation" ON "discount_approvals"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- =============================================================================
-- 6) Webhook — tenant başına abonelik (URL + event[] + secret HMAC)
-- =============================================================================

CREATE TABLE "webhooks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "url" VARCHAR(500) NOT NULL,
  "secret" VARCHAR(128) NOT NULL,
  "events" TEXT[] NOT NULL DEFAULT '{}',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  CONSTRAINT "webhooks_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "webhooks_tenant_active_idx"
  ON "webhooks" ("tenant_id", "is_active");

ALTER TABLE "webhooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhooks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "webhooks_tenant_isolation" ON "webhooks"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- =============================================================================
-- 7) WebhookDelivery — emit anında pending, retry cron işler
-- Exponential schedule [1m, 5m, 30m, 2h, 24h]; 5. fail = dead_letter
-- (status_next_retry index cron polling için kritik)
-- =============================================================================

CREATE TABLE "webhook_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "webhook_id" UUID NOT NULL,
  "event" VARCHAR(100) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMP(3),
  "last_response" VARCHAR(1000),
  "last_error" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "delivered_at" TIMESTAMP(3),
  PRIMARY KEY ("id"),
  CONSTRAINT "webhook_deliveries_status_check"
    CHECK ("status" IN ('pending', 'delivered', 'failed', 'dead_letter')),
  CONSTRAINT "webhook_deliveries_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "webhook_deliveries_webhook_fkey"
    FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE
);

-- Cron polling için kritik: status=pending|failed && next_retry_at<=now()
CREATE INDEX "webhook_deliveries_status_retry_idx"
  ON "webhook_deliveries" ("status", "next_retry_at");
CREATE INDEX "webhook_deliveries_tenant_webhook_idx"
  ON "webhook_deliveries" ("tenant_id", "webhook_id", "created_at" DESC);

ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "webhook_deliveries_tenant_isolation" ON "webhook_deliveries"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- =============================================================================
-- updated_at triggers (mevcut pattern — billing/cash migration'da kullanılan
-- update_updated_at_column fonksiyonu zaten projede; ekleyelim)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END $$;

CREATE TRIGGER "dashboard_layouts_updated_at"
  BEFORE UPDATE ON "dashboard_layouts"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "permission_assignments_updated_at"
  BEFORE UPDATE ON "permission_assignments"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "discount_approvals_updated_at"
  BEFORE UPDATE ON "discount_approvals"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "webhooks_updated_at"
  BEFORE UPDATE ON "webhooks"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
