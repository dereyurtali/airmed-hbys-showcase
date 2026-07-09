-- E6 Fraud Detection (kural-tabanlı, v0.2 dilimi)
-- FraudRule (4 default) + FraudAlert (kural tetiklendikçe oluşur).

CREATE TYPE "FraudRuleKey" AS ENUM (
  'night_operations',
  'stock_consume_without_surgery',
  'multi_ip_login',
  'frequent_patient_appointment'
);
CREATE TYPE "FraudSeverity" AS ENUM ('low', 'medium', 'high');
CREATE TYPE "FraudAlertStatus" AS ENUM ('new', 'reviewing', 'resolved', 'false_positive');

-- fraud_rules
CREATE TABLE "fraud_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" "FraudRuleKey" NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "severity" "FraudSeverity" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fraud_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fraud_rules_tenant_key_unique"
  ON "fraud_rules"("tenant_id", "key");
CREATE INDEX "fraud_rules_tenant_active_idx"
  ON "fraud_rules"("tenant_id", "is_active");

ALTER TABLE "fraud_rules"
  ADD CONSTRAINT "fraud_rules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- fraud_alerts
CREATE TABLE "fraud_alerts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "rule_key" "FraudRuleKey" NOT NULL,
    "severity" "FraudSeverity" NOT NULL,
    "actor_user_id" UUID,
    "entity_type" VARCHAR(50),
    "entity_id" UUID,
    "signature_key" VARCHAR(255) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" "FraudAlertStatus" NOT NULL DEFAULT 'new',
    "review_note" VARCHAR(1000),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fraud_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fraud_alerts_tenant_signature_unique"
  ON "fraud_alerts"("tenant_id", "signature_key");
CREATE INDEX "fraud_alerts_tenant_status_sev_created_idx"
  ON "fraud_alerts"("tenant_id", "status", "severity", "created_at" DESC);
CREATE INDEX "fraud_alerts_tenant_rule_created_idx"
  ON "fraud_alerts"("tenant_id", "rule_id", "created_at" DESC);
CREATE INDEX "fraud_alerts_tenant_actor_created_idx"
  ON "fraud_alerts"("tenant_id", "actor_user_id", "created_at" DESC);

ALTER TABLE "fraud_alerts"
  ADD CONSTRAINT "fraud_alerts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fraud_alerts"
  ADD CONSTRAINT "fraud_alerts_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "fraud_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fraud_alerts"
  ADD CONSTRAINT "fraud_alerts_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fraud_alerts"
  ADD CONSTRAINT "fraud_alerts_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (NULL-safe pattern)
ALTER TABLE "fraud_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fraud_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "fraud_rules_tenant_isolation" ON "fraud_rules"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "fraud_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fraud_alerts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "fraud_alerts_tenant_isolation" ON "fraud_alerts"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
