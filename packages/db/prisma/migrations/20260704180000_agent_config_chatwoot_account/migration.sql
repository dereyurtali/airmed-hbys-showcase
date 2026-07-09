-- #1070 — Chatwoot webhook tenant çözümü index'li kolondan.
-- Eskiden her inbound webhook `channel_settings->'chatwootAccountId'` JSONB
-- path sorgusuyla (index'siz) tenant çözüyordu. Kolon + unique index; mevcut
-- değerler JSONB'den backfill edilir, updateConfig senkron tutar.

-- AlterTable
ALTER TABLE "agent_configs" ADD COLUMN "chatwoot_account_id" INTEGER;

-- Backfill (channel_settings jsonb; sayı ya da sayısal string olabilir)
UPDATE "agent_configs"
SET "chatwoot_account_id" = NULLIF("channel_settings"->>'chatwootAccountId', '')::int
WHERE "channel_settings" IS NOT NULL
  AND "channel_settings" ? 'chatwootAccountId';

-- CreateIndex
CREATE UNIQUE INDEX "agent_configs_chatwoot_account_id_key" ON "agent_configs"("chatwoot_account_id");
