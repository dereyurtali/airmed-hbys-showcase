-- #1058 — Cross-tenant worker'lar için partial index'ler.
--
-- Üç background worker admin/unscoped client ile (WHERE'de tenant_id YOK)
-- tarama yapar; mevcut tenant-leading composite index'leri KULLANAMAZ ve her
-- tick'te seq scan'e düşer (automation 5sn / messaging 10sn / no-show 5dk).
-- Partial index'ler yalnız aktif/bekleyen satırları kapsar → tablolar büyüse
-- de küçük kalırlar.
--
-- Prisma partial index'i modelleyemez (tenant_impersonations partial unique
-- emsali): kaynak bu raw SQL'dir; schema.prisma'da modele yorum düşülür.
-- prisma migrate diff bu index'leri görmez → drop planına da ALMAZ (#959'daki
-- drift map'siz TAM index'ler içindi).

CREATE INDEX "agent_messages_unprocessed_idx"
  ON "agent_messages" ("created_at")
  WHERE "role" = 'patient' AND "processed_at" IS NULL;

CREATE INDEX "message_deliveries_pending_idx"
  ON "message_deliveries" ("scheduled_at")
  WHERE "status" = 'PENDING';

CREATE INDEX "appointments_scheduled_starts_idx"
  ON "appointments" ("starts_at")
  WHERE "status" = 'scheduled' AND "deleted_at" IS NULL;
