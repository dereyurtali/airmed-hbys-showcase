-- S15-PR3 — WHO Surgical Safety Checklist (21 item, 3 faz).
-- Her ameliyat için 1:1 (surgery_id @unique). Faz bazlı completed_at +
-- completed_by snapshot'ı; item'lerin teker teker check state'i items JSON'da.

CREATE TABLE "surgical_safety_checks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "surgery_id" UUID NOT NULL,
  "items" JSONB NOT NULL DEFAULT '{}',
  "sign_in_completed_at" TIMESTAMP(3),
  "sign_in_completed_by" UUID,
  "time_out_completed_at" TIMESTAMP(3),
  "time_out_completed_by" UUID,
  "sign_out_completed_at" TIMESTAMP(3),
  "sign_out_completed_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "surgical_safety_checks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "surgical_safety_checks_surgery_id_key"
  ON "surgical_safety_checks" ("surgery_id");

CREATE INDEX "surgical_safety_checks_tenant_id_idx"
  ON "surgical_safety_checks" ("tenant_id");

ALTER TABLE "surgical_safety_checks"
  ADD CONSTRAINT "surgical_safety_checks_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "surgical_safety_checks"
  ADD CONSTRAINT "surgical_safety_checks_surgery_id_fkey"
  FOREIGN KEY ("surgery_id") REFERENCES "surgeries" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: tenant policy (tüm RLS-aware tablolar için standart pattern).
ALTER TABLE "surgical_safety_checks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "surgical_safety_checks_tenant_isolation"
  ON "surgical_safety_checks"
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

-- Sync outbox trigger (S10b A12 pattern): üçüncü taraf cihaz entegrasyonu
-- veya hibrit bulut sync için her INSERT/UPDATE outbox'a satır atar.
CREATE TRIGGER "surgical_safety_checks_sync_outbox"
  AFTER INSERT OR UPDATE OR DELETE ON "surgical_safety_checks"
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('surgical_safety_check');
