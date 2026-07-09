-- #424 — Göz acili triyaj önceliği. Acil hasta kuyruğun en önüne çıkar
-- (Break Glass / önce-öde bypass'tan ayrı; yalnız kuyruk sırası).
ALTER TABLE "encounters" ADD COLUMN "is_urgent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "encounters" ADD COLUMN "urgent_reason" VARCHAR(200);

CREATE INDEX "encounters_urgent_idx" ON "encounters" ("tenant_id", "is_urgent");
