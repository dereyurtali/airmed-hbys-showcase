-- Madde 5 — ServiceItem.preconditions JSON kolonu (yaş limit, zorunlu hizmet kodları, yaş bazlı otomatik indirim).
ALTER TABLE "service_items" ADD COLUMN "preconditions" JSONB NOT NULL DEFAULT '{}'::jsonb;
