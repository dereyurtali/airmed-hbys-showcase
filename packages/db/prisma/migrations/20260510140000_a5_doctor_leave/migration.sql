-- A5 doktor izin/tatil — DoctorLeave model.
--
-- Slot calculation: doktorun çalışma saati (DoctorAvailability) − bu izin
-- aralığı − mevcut randevular = müsait slot. Service tarafında app-level
-- hesaplama; DB sadece izin satırlarını ve indeksini sağlar.
--
-- Çakışma kontrolü: aynı doktorun iki izni çakışabilir (tek günü iki kez
-- işaretlemek anlamsız ama hata değil); appointment EXCLUDE GIST gibi
-- DB-level no-overlap koymadık.
--
-- onDelete: Cascade — Doctor hard delete edilirse leave'leri temizlenir.
-- Soft-delete (Doctor.deletedAt) durumunda leaves DB'de kalır; service
-- katmanı doctor.findById ile zaten soft-deleted'leri filtreliyor.

CREATE TABLE "doctor_leaves" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_leaves_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "doctor_leaves_tenant_id_doctor_id_starts_at_idx"
    ON "doctor_leaves"("tenant_id", "doctor_id", "starts_at");

ALTER TABLE "doctor_leaves"
    ADD CONSTRAINT "doctor_leaves_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "doctor_leaves"
    ADD CONSTRAINT "doctor_leaves_doctor_id_fkey"
    FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Multi-tenant RLS — null-safe pattern (bkz. 20260506200000_rls_policy_null_safe).
ALTER TABLE "doctor_leaves" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_leaves" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "doctor_leaves"
    USING (
      tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
    WITH CHECK (
      tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );
