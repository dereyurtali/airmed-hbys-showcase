-- #1059 — takvim + açık-encounter index'leri.
--
-- 1. appointment.findInRange doctorId'siz (haftalık tüm-doktor görünümü)
--    çağrıldığında lider kolonu starts_at olan index yoktu → tenant'ın tüm
--    randevuları taranıp tarih aralığı residual filter'la ayıklanıyordu.
--    İsim Prisma default'u = schema.prisma @@index([tenantId, startsAt]) ile
--    birebir → drift yok.
CREATE INDEX "appointments_tenant_id_starts_at_idx" ON "appointments"("tenant_id", "starts_at");

-- 2. Açık encounter sayacı (dailyHuddle: closed_at IS NULL) — açık encounter
--    her zaman az; klasik partial index. Prisma partial modelleyemez → kaynak
--    bu raw SQL, schema.prisma'da yorum (#1058 deseni).
CREATE INDEX "encounters_open_idx" ON "encounters" ("tenant_id")
  WHERE "closed_at" IS NULL AND "deleted_at" IS NULL;
