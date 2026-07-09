-- S4 — Doktor-hasta atama tablosu (karar tutanağı 2026-05-27 §7).
--
-- Hibrit atama: auto (randevu/muayene/cerrahi hook'larından upsert) +
-- manual (resepsiyon yeni hasta eklerken primary doctor) + transfer
-- (yönetici devretmesi, ileride S8 UI).
--
-- Doktor `/patients` listesinde sadece atanmış hastaları görür; doğrudan
-- patient_id sorgusu PatientService'de uygulanır (User.flags.can_see_all_patients
-- S5'te override).

CREATE TABLE "patient_doctors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(20) NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" UUID,
    CONSTRAINT "patient_doctors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "patient_doctors_tenant_patient_doctor_key"
  ON "patient_doctors"("tenant_id", "patient_id", "doctor_id");
CREATE INDEX "patient_doctors_tenant_doctor_assigned_idx"
  ON "patient_doctors"("tenant_id", "doctor_id", "assigned_at" DESC);
CREATE INDEX "patient_doctors_tenant_patient_primary_idx"
  ON "patient_doctors"("tenant_id", "patient_id", "is_primary");

ALTER TABLE "patient_doctors"
  ADD CONSTRAINT "patient_doctors_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_doctors"
  ADD CONSTRAINT "patient_doctors_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_doctors"
  ADD CONSTRAINT "patient_doctors_doctor_id_fkey"
  FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_doctors"
  ADD CONSTRAINT "patient_doctors_assigned_by_fkey"
  FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS — tenant izolasyonu mevcut pattern ile birebir
ALTER TABLE "patient_doctors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_doctors" FORCE ROW LEVEL SECURITY;
CREATE POLICY "patient_doctors_tenant_isolation" ON "patient_doctors"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Sync outbox trigger (A12 — hibrit sync için her tenant tablosu sync edilir)
CREATE TRIGGER "patient_doctors_sync_outbox"
  AFTER INSERT OR UPDATE OR DELETE ON "patient_doctors"
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('patientDoctor');
