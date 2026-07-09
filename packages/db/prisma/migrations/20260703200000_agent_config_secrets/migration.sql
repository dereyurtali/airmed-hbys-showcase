-- #1034 — Otomasyon sırları ekrandan yönetilir; DB'de AES-256-GCM şifreli
-- (v1.gcm.<iv>.<tag>.<ct> formatı, #914 TOTP kalıbı). Düz metin ASLA yazılmaz.
ALTER TABLE "agent_configs" ADD COLUMN "webhook_secret_enc" TEXT;
ALTER TABLE "agent_configs" ADD COLUMN "chatwoot_bot_token_enc" TEXT;
ALTER TABLE "agent_configs" ADD COLUMN "anthropic_key_enc" TEXT;
ALTER TABLE "agent_configs" ADD COLUMN "openrouter_key_enc" TEXT;
