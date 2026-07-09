-- S15-PR5 — Break Glass: acil durumda "önce öde sonra hizmet" kuralı bypass.
-- Encounter'a 5 alan + EncounterStage enum'a 'emergency_bypass' değeri.

ALTER TYPE "EncounterStage" ADD VALUE IF NOT EXISTS 'emergency_bypass';

ALTER TABLE "encounters"
  ADD COLUMN "emergency_bypass_reason" VARCHAR(500),
  ADD COLUMN "emergency_bypass_activated_at" TIMESTAMP(3),
  ADD COLUMN "emergency_bypass_activated_by" UUID,
  ADD COLUMN "emergency_bypass_closed_at" TIMESTAMP(3),
  ADD COLUMN "emergency_bypass_closed_by" UUID;

-- Aktif bypass'ların hızlı tarama indexi: assertPaidSession her servis create
-- sırasında çağrılır; index'siz scan büyük tenant'larda yavaşlar.
CREATE INDEX "encounters_active_bypass_idx"
  ON "encounters" (tenant_id, patient_id)
  WHERE emergency_bypass_activated_at IS NOT NULL
    AND emergency_bypass_closed_at IS NULL;
