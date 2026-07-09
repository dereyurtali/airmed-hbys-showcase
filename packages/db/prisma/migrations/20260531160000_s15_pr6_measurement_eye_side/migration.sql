-- S15-PR6 — Measurement modeline eye_side zorunlu kolon. Yanlış göz cerrahisi
-- sebep #1 olduğu için her ölçüm kaydında göz tarafı yapısal alan olarak
-- tutulur (values JSON içinde serbest yerine).

-- Mevcut satırlara default 'ou' (her iki göz) — geçmiş ölçümler tipik olarak
-- bilateral veya values JSON'da göz bilgisi var; yanlış kayıt değil.
ALTER TABLE "measurements"
  ADD COLUMN "eye_side" "EyeSide" NOT NULL DEFAULT 'ou';

-- Yönetici "doktor başına yanlış göz analizi" raporu için index.
CREATE INDEX "measurements_eye_side_idx"
  ON "measurements" (tenant_id, eye_side, measured_at);
