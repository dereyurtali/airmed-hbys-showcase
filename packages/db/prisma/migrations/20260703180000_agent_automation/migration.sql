-- EPIC #1018 / #1020 — AI Hasta Asistanı (otomasyon) veri modeli.
-- agent_configs (+revizyon geçmişi), agent_conversations, agent_messages
-- (inbound DB-kuyruk: processed_at IS NULL), agent_actions (denetim).
-- RLS: kanonik NULLIF(app.current_tenant_id) policy (20260624140000 formu).
-- Grant'ler ALTER DEFAULT PRIVILEGES'ten miras (20260605170000 + 20260703110000).

CREATE TYPE "AgentChannel" AS ENUM ('whatsapp', 'instagram', 'facebook', 'telegram', 'webchat', 'other');
CREATE TYPE "AgentConversationStatus" AS ENUM ('bot_active', 'human_active', 'closed');
CREATE TYPE "AgentMessageRole" AS ENUM ('patient', 'assistant', 'staff', 'system');
CREATE TYPE "AgentActionType" AS ENUM ('appointment_created', 'appointment_cancelled', 'patient_created', 'patient_matched', 'handoff', 'error');

CREATE TABLE "agent_configs" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "provider" VARCHAR(40) NOT NULL DEFAULT 'anthropic',
  "model" VARCHAR(120) NOT NULL DEFAULT 'claude-opus-4-8',
  "system_prompt" TEXT NOT NULL,
  "knowledge_base" TEXT,
  "channel_settings" JSONB,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_configs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION
);

CREATE UNIQUE INDEX "agent_configs_tenant_id_key" ON "agent_configs" ("tenant_id");

CREATE TABLE "agent_config_revisions" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "config_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "model" VARCHAR(120) NOT NULL,
  "system_prompt" TEXT NOT NULL,
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_config_revisions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION,
  CONSTRAINT "agent_config_revisions_config_id_fkey"
    FOREIGN KEY ("config_id") REFERENCES "agent_configs"("id") ON DELETE CASCADE,
  CONSTRAINT "agent_config_revisions_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "agent_config_revisions_config_id_revision_key"
  ON "agent_config_revisions" ("config_id", "revision");

CREATE TABLE "agent_conversations" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "channel" "AgentChannel" NOT NULL,
  "chatwoot_conversation_id" INTEGER NOT NULL,
  "patient_id" UUID,
  "contact_name" VARCHAR(200),
  "contact_phone" VARCHAR(20),
  "status" "AgentConversationStatus" NOT NULL DEFAULT 'bot_active',
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "handed_off_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "agent_conversations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION,
  CONSTRAINT "agent_conversations_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE NO ACTION
);

CREATE UNIQUE INDEX "agent_conversations_tenant_id_chatwoot_conversation_id_key"
  ON "agent_conversations" ("tenant_id", "chatwoot_conversation_id");
CREATE INDEX "agent_conversations_tenant_id_status_last_message_at_idx"
  ON "agent_conversations" ("tenant_id", "status", "last_message_at" DESC);
CREATE INDEX "agent_conversations_tenant_id_patient_id_idx"
  ON "agent_conversations" ("tenant_id", "patient_id");

CREATE TABLE "agent_messages" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "role" "AgentMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "tool_calls" JSONB,
  "chatwoot_message_id" INTEGER,
  "processed_at" TIMESTAMP(3),
  "error" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_messages_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION,
  CONSTRAINT "agent_messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "agent_messages_tenant_id_chatwoot_message_id_key"
  ON "agent_messages" ("tenant_id", "chatwoot_message_id");
CREATE INDEX "agent_messages_tenant_id_conversation_id_created_at_idx"
  ON "agent_messages" ("tenant_id", "conversation_id", "created_at");
CREATE INDEX "agent_messages_tenant_id_role_processed_at_idx"
  ON "agent_messages" ("tenant_id", "role", "processed_at");

CREATE TABLE "agent_actions" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID,
  "type" "AgentActionType" NOT NULL,
  "ref_id" UUID,
  "summary" VARCHAR(500) NOT NULL,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_actions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION,
  CONSTRAINT "agent_actions_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE CASCADE
);

CREATE INDEX "agent_actions_tenant_id_created_at_idx"
  ON "agent_actions" ("tenant_id", "created_at" DESC);
CREATE INDEX "agent_actions_tenant_id_type_created_at_idx"
  ON "agent_actions" ("tenant_id", "type", "created_at" DESC);

-- Row Level Security — kanonik tenant izolasyonu (USING + WITH CHECK).
ALTER TABLE "agent_configs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_configs_tenant_isolation" ON "agent_configs"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "agent_config_revisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_config_revisions_tenant_isolation" ON "agent_config_revisions"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "agent_conversations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_conversations_tenant_isolation" ON "agent_conversations"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "agent_messages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_messages_tenant_isolation" ON "agent_messages"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "agent_actions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_actions_tenant_isolation" ON "agent_actions"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
