-- #368 — VisitingWindow: ziyaretçi doktor tarih-bazlı müsaitlik penceresi.
-- Tanımlıysa randevu yalnız bu aralıklara verilebilir (DoctorAvailability'ye ek).

CREATE TABLE "visiting_windows" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "doctor_id" UUID NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "notes" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "visiting_windows_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION,
  CONSTRAINT "visiting_windows_doctor_id_fkey"
    FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE
);

CREATE INDEX "visiting_windows_lookup_idx"
  ON "visiting_windows" ("tenant_id", "doctor_id", "starts_at");

-- RLS — kanonik pattern (app.current_tenant_id, NULLIF formu).
ALTER TABLE "visiting_windows" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "visiting_windows_tenant_isolation" ON "visiting_windows"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- airmed_app rolüne tablo yetkileri (yeni tablo; init.sql blanket grant'i sonra
-- çalışıyorsa gereksiz ama idempotent güvence).
GRANT SELECT, INSERT, UPDATE, DELETE ON "visiting_windows" TO airmed_app;
