-- D1 — Mesajlaşma altyapısı (klinik bildirim sistemi).
-- 3 tablo: message_templates (3-dilli Handlebars body), message_triggers
-- (config + ON/OFF + quiet hours), message_deliveries (queue + log birleşik).

CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "trigger_key" VARCHAR(60) NOT NULL,
    "language" VARCHAR(5) NOT NULL,
    "subject" VARCHAR(200),
    "body" TEXT NOT NULL,
    "variables" VARCHAR(50)[],
    "channel_type" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "message_triggers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "channels" VARCHAR(20)[],
    "quiet_hours_start" INTEGER,
    "quiet_hours_end" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_triggers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "message_deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "trigger_key" VARCHAR(60) NOT NULL,
    "channel_type" VARCHAR(20) NOT NULL,
    "recipient" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(200),
    "body" TEXT NOT NULL,
    "context_snapshot" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "message_templates_tenant_id_deleted_at_idx" ON "message_templates"("tenant_id", "deleted_at");
CREATE UNIQUE INDEX "message_templates_tenant_id_trigger_key_language_channel_ty_key" ON "message_templates"("tenant_id", "trigger_key", "language", "channel_type");
CREATE INDEX "message_triggers_tenant_id_is_enabled_idx" ON "message_triggers"("tenant_id", "is_enabled");
CREATE UNIQUE INDEX "message_triggers_tenant_id_key_key" ON "message_triggers"("tenant_id", "key");
CREATE INDEX "message_deliveries_tenant_id_status_scheduled_at_idx" ON "message_deliveries"("tenant_id", "status", "scheduled_at");
CREATE INDEX "message_deliveries_tenant_id_trigger_key_created_at_idx" ON "message_deliveries"("tenant_id", "trigger_key", "created_at" DESC);
CREATE INDEX "message_deliveries_tenant_id_recipient_created_at_idx" ON "message_deliveries"("tenant_id", "recipient", "created_at" DESC);

ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_triggers" ADD CONSTRAINT "message_triggers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
