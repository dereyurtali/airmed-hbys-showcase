-- #362 — ServiceItem.metadata: kategori-özel yapısal metadata (cerrahi katalog
-- lens/malzeme/alt-grup). preconditions gating'ten ayrı; null/boş diğer kategorilerde.
ALTER TABLE "service_items" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb;
