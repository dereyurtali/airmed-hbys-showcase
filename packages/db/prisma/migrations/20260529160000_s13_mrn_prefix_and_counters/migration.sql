-- S13 — MRN üretimi: klinik kodu + yıl + Verhoeff + atomik sayaç
-- Tasarım: .claude/plans/* (Ali onayı 2026-05-29).
--
-- 1) Tenant'a mrn_prefix (klinik kodu, 2 char; örn DemoEye Dushanbe = "TD")
-- 2) mrn_counters tablosu — (tenant_id, year) composite PK + last_seq atomik

ALTER TABLE "tenants"
  ADD COLUMN "mrn_prefix" VARCHAR(4) NOT NULL DEFAULT '';

-- Pilot tenant (DemoEye Clinic Dushanbe) için seed
UPDATE "tenants" SET "mrn_prefix" = 'TD' WHERE "slug" = 'demoeye';

CREATE TABLE "mrn_counters" (
  "tenant_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "last_seq" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("tenant_id", "year"),
  CONSTRAINT "mrn_counters_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

-- RLS (tenant izolasyon — UPSERT/SELECT yalnız kendi tenant'ında)
ALTER TABLE "mrn_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mrn_counters" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mrn_counters_tenant_isolation" ON "mrn_counters"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);
