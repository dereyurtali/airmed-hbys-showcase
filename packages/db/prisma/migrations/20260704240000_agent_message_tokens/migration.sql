-- #1089 — AgentMessage token kullanımı (platform AI izleme). Nullable; eski
-- satırlar null kalır. Maliyet UI'da model-fiyat tablosuyla hesaplanır.
ALTER TABLE "agent_messages"
  ADD COLUMN "input_tokens" INTEGER,
  ADD COLUMN "output_tokens" INTEGER,
  ADD COLUMN "model" VARCHAR(100);
