-- F3 Tenants yönetimi — suspend metadata
ALTER TABLE "tenants"
  ADD COLUMN "suspend_reason" VARCHAR(50),
  ADD COLUMN "suspend_note" VARCHAR(1000),
  ADD COLUMN "auto_reactivate_at" TIMESTAMP(3);
