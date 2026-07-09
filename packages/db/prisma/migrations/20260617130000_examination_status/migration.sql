-- #379 — Muayene taslak/kesin durumu. Doktor muayeneyi bitirmeden ölçüm
-- isterse yazdıkları "draft" korunur (geri çağrılınca devam). Eski kayıtlar
-- final (kolon default'u mevcut satırlara da uygulanır).
CREATE TYPE "ExaminationStatus" AS ENUM ('draft', 'final');

ALTER TABLE "examinations"
  ADD COLUMN "status" "ExaminationStatus" NOT NULL DEFAULT 'final';
