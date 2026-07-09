-- E2 Doktor Hakediş & Komisyon (v0.2 dilimi)
-- CommissionRule (kurallar) + CommissionEntry (hesaplanmış kayıtlar).

-- Enums
CREATE TYPE "CommissionRuleType" AS ENUM ('per_surgery', 'percentage');
CREATE TYPE "CommissionEntryStatus" AS ENUM ('pending', 'approved', 'paid', 'cancelled');
CREATE TYPE "CommissionSourceType" AS ENUM ('surgery', 'procedure');

-- commission_rules
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "doctor_id" UUID,
    "type" "CommissionRuleType" NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "applicable_surgery_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "applicable_procedure_types" "ProcedureType"[] NOT NULL DEFAULT ARRAY[]::"ProcedureType"[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "commission_rules_tenant_doctor_active_deleted_idx"
  ON "commission_rules"("tenant_id", "doctor_id", "is_active", "deleted_at");
CREATE INDEX "commission_rules_tenant_validity_idx"
  ON "commission_rules"("tenant_id", "valid_from", "valid_to");

ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_rules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_rules_doctor_id_fkey"
  FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- commission_entries
CREATE TABLE "commission_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "rule_id" UUID,
    "source_type" "CommissionSourceType" NOT NULL,
    "source_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "base_amount" DECIMAL(10,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "status" "CommissionEntryStatus" NOT NULL DEFAULT 'pending',
    "snapshot_data" JSONB NOT NULL DEFAULT '{}',
    "rejection_reason" VARCHAR(500),
    "paid_at" TIMESTAMP(3),
    "paid_method" VARCHAR(50),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "commission_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commission_entries_tenant_source_unique"
  ON "commission_entries"("tenant_id", "source_type", "source_id");
CREATE INDEX "commission_entries_tenant_doctor_calculated_idx"
  ON "commission_entries"("tenant_id", "doctor_id", "calculated_at" DESC);
CREATE INDEX "commission_entries_tenant_status_calculated_idx"
  ON "commission_entries"("tenant_id", "status", "calculated_at" DESC);
CREATE INDEX "commission_entries_tenant_deleted_idx"
  ON "commission_entries"("tenant_id", "deleted_at");

ALTER TABLE "commission_entries"
  ADD CONSTRAINT "commission_entries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_entries"
  ADD CONSTRAINT "commission_entries_doctor_id_fkey"
  FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_entries"
  ADD CONSTRAINT "commission_entries_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "commission_entries"
  ADD CONSTRAINT "commission_entries_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (NULL-safe pattern, diğer modüllerle aynı)
ALTER TABLE "commission_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commission_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "commission_rules_tenant_isolation" ON "commission_rules"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "commission_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commission_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "commission_entries_tenant_isolation" ON "commission_entries"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
