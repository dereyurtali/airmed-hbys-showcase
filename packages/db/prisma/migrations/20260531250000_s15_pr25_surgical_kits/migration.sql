-- S15-PR25 — Surgical Kit (ameliyat sarf reçetesi).

CREATE TABLE "surgical_kits" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "surgery_type" VARCHAR(60) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "notes" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "surgical_kits_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION,
  CONSTRAINT "surgical_kits_tenant_code_unique" UNIQUE ("tenant_id", "code")
);

CREATE INDEX "surgical_kits_tenant_surgery_type_idx"
  ON "surgical_kits" ("tenant_id", "surgery_type", "is_active");

CREATE TABLE "surgical_kit_components" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "kit_id" UUID NOT NULL,
  "iol_model_id" UUID,
  "component_name" VARCHAR(150),
  "quantity" INT NOT NULL DEFAULT 1,
  "is_required" BOOLEAN NOT NULL DEFAULT true,
  "notes" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "surgical_kit_components_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION,
  CONSTRAINT "surgical_kit_components_kit_id_fkey"
    FOREIGN KEY ("kit_id") REFERENCES "surgical_kits"("id") ON DELETE CASCADE,
  CONSTRAINT "surgical_kit_components_iol_model_id_fkey"
    FOREIGN KEY ("iol_model_id") REFERENCES "iol_models"("id") ON DELETE NO ACTION
);

CREATE INDEX "surgical_kit_components_tenant_kit_idx"
  ON "surgical_kit_components" ("tenant_id", "kit_id");

ALTER TABLE "surgical_kits" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "surgical_kits_tenant_isolation" ON "surgical_kits"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "surgical_kit_components" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "surgical_kit_components_tenant_isolation" ON "surgical_kit_components"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
