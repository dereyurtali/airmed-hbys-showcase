-- #1159 — Lobi bekleme ekranı (Raspberry Pi kiosk) yayın anahtarı.
-- Düz metin saklanmaz; yalnız SHA-256 hex hash (@unique). null = yayın kapalı.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "public_monitor_key_hash" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_public_monitor_key_hash_key" ON "tenants"("public_monitor_key_hash");
