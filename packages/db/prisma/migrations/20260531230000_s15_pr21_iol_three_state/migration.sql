-- S15-PR21 — IolLot 3-state stok modeli + optimistic concurrency.
-- Mevcut quantity = available_qty olarak backfill; reserved + consumed = 0.

ALTER TABLE "iol_lots"
  ADD COLUMN "available_qty" INT NOT NULL DEFAULT 0,
  ADD COLUMN "reserved_qty" INT NOT NULL DEFAULT 0,
  ADD COLUMN "consumed_qty" INT NOT NULL DEFAULT 0,
  ADD COLUMN "version" INT NOT NULL DEFAULT 0;

-- Backfill: legacy quantity available_qty'a kopyalanır.
UPDATE "iol_lots"
SET "available_qty" = "quantity"
WHERE "available_qty" = 0 AND "quantity" > 0;

CREATE INDEX "iol_lots_tenant_available_idx"
  ON "iol_lots" ("tenant_id", "available_qty")
  WHERE "deleted_at" IS NULL;
