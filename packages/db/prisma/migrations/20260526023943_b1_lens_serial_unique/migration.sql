-- B1 PR 2 — Lens seri no "tek kullanım" kuralı yorum satırında belirtilmişti
-- ("partial unique index") ama uygulanmamış; mevcut @@index unique değil.
-- Backend (surgery.service.ts registerLens) findFirst + insert ile kontrol
-- ediyordu → klasik TOCTOU race: iki cerrah aynı anda aynı seri no'yu
-- girerse her ikisi de pre-check'i geçer → DB'de bir lens iki hastaya
-- implant edilmiş gibi görünür (stok tutarsızlığı + yasal sorun).
--
-- Partial unique: tenant scope'unda + null değil + soft-delete edilmemiş
-- satırlar arasında benzersiz. P2002 catch ile uygulama katmanında
-- ConflictException'a çevriliyor (atomic, race-free).
--
-- Prisma şemasında @@unique partial syntax desteklenmediği için raw SQL.

CREATE UNIQUE INDEX IF NOT EXISTS "surgeries_tenant_lens_serial_unique"
  ON "surgeries"("tenant_id", "lens_serial_number")
  WHERE "lens_serial_number" IS NOT NULL AND "deleted_at" IS NULL;
