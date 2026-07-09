-- S15a — Encounter (hasta ziyaret akışı / istasyon yolculuğu).
--
-- Bir hastanın klinikteki tek günlük yolculuğunu modeller. Appointment.status
-- (takvim/scheduling) korunur; Encounter.stage klinik istasyon yolculuğunu sürer:
-- resepsiyon → muayene ödemesi → doktor → ölçüm (ödeme) → reçete/ameliyat-satış.
--
-- Ödeme birinci sınıf istasyondur: muayene ücreti ödenmeden hasta doktor
-- kuyruğuna (waiting_doctor) geçemez (kapı: InvoiceService.assertPaidSession).
-- appointment_id nullable → randevusuz (walk-in) hasta; @unique → 1 randevu 1 ziyaret.

-- CreateEnum
CREATE TYPE "EncounterStage" AS ENUM ('registered', 'awaiting_exam_payment', 'waiting_doctor', 'in_exam', 'awaiting_measurement_payment', 'in_measurement', 'measurement_ready', 'awaiting_surgery_sales', 'done', 'cancelled');

-- CreateTable
CREATE TABLE "encounters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "appointment_id" UUID,
    "doctor_id" UUID,
    "stage" "EncounterStage" NOT NULL DEFAULT 'registered',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stage_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "encounters_appointment_id_key" ON "encounters"("appointment_id");
CREATE INDEX "encounters_tenant_id_doctor_id_stage_idx" ON "encounters"("tenant_id", "doctor_id", "stage");
CREATE INDEX "encounters_tenant_id_stage_stage_updated_at_idx" ON "encounters"("tenant_id", "stage", "stage_updated_at");
CREATE INDEX "encounters_tenant_id_patient_id_opened_at_idx" ON "encounters"("tenant_id", "patient_id", "opened_at");
CREATE INDEX "encounters_tenant_id_deleted_at_idx" ON "encounters"("tenant_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS — tenant izolasyonu (mevcut patient_doctors pattern ile birebir)
ALTER TABLE "encounters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "encounters" FORCE ROW LEVEL SECURITY;
CREATE POLICY "encounters_tenant_isolation" ON "encounters"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Sync outbox trigger (A12 — hibrit sync için her tenant tablosu sync edilir)
CREATE TRIGGER "encounters_sync_outbox"
  AFTER INSERT OR UPDATE OR DELETE ON "encounters"
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('encounter');
