-- #375 — LeadSource'a second_opinion (ikinci görüş yapısal intake).
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'second_opinion' BEFORE 'other';

-- #378 — Randevu geliş kanalı (telefon/Instagram/Telegram…). LeadFunnel raporu için.
ALTER TABLE "appointments" ADD COLUMN "source" "LeadSource";
