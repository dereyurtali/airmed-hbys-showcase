-- S16 — Stok & Malzeme Takibi: sarf malzemeye kısa kod + rezerve miktar.
ALTER TABLE "consumables"
  ADD COLUMN "code" VARCHAR(40),
  ADD COLUMN "reserved_qty" INTEGER NOT NULL DEFAULT 0;
