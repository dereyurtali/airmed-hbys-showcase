-- S11e — Commission ↔ Payment karma entegrasyon (karar tutanağı §10).
-- Yeni alan: collection_status + collected_amount.
-- PaymentService.create sonrası ilgili surgery/procedure commission_entry'sine
-- net ödenmiş tutar (TJS karşılığı) yansıtılır; status pending/partial/collected.

CREATE TYPE "CommissionCollectionStatus" AS ENUM ('pending', 'partial', 'collected');

ALTER TABLE "commission_entries"
  ADD COLUMN "collection_status" "CommissionCollectionStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "collected_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Mevcut entry'ler için default 'pending' + 0 yeterli; UI yöneticisi göz atınca
-- "tahsilatsız hakediş" işaretini görebilir. Backfill yok.
