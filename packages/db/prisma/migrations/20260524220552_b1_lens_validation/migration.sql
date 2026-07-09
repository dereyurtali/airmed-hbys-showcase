-- B1 PR 2 — Lens implant tracking + complication structured detail.

ALTER TABLE "surgeries"
  ADD COLUMN "lens_implant_lot_id" UUID,
  ADD COLUMN "lens_serial_number" VARCHAR(50),
  ADD COLUMN "lens_barcode" VARCHAR(100),
  ADD COLUMN "lens_is_override" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lens_override_reason" VARCHAR(500),
  ADD COLUMN "complication_detail" JSONB;

CREATE INDEX "surgeries_tenant_id_lens_serial_number_idx"
  ON "surgeries"("tenant_id", "lens_serial_number");

-- Aynı serial 2 cerrahide kullanılamaz (tenant-scoped, sadece null değil).
-- Plan: 'Aynı seri no daha önce başka cerrahide kullanılmışsa 409 conflict'
CREATE UNIQUE INDEX "surgeries_tenant_lens_serial_unique"
  ON "surgeries"("tenant_id", "lens_serial_number")
  WHERE "lens_serial_number" IS NOT NULL AND "deleted_at" IS NULL;

ALTER TABLE "surgeries"
  ADD CONSTRAINT "surgeries_lens_implant_lot_id_fkey"
  FOREIGN KEY ("lens_implant_lot_id") REFERENCES "iol_lots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
