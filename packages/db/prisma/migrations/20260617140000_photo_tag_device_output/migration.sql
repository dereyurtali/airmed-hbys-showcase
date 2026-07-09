-- #426 — Cihaz entegrasyonu MVP: ölçüm/biyometri cihazı çıktısını (PDF/görsel)
-- hasta kaydına iliştirme. PhotoTag'e device_output kategorisi eklenir.
ALTER TYPE "PhotoTag" ADD VALUE IF NOT EXISTS 'device_output';
