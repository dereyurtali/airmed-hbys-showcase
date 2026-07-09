-- C2 Consent (templates + signings) — patient legal documents with digital signature

CREATE TYPE "ConsentProcedureType" AS ENUM ('cataract', 'retina', 'laser', 'intravitreal', 'refractive', 'general');
CREATE TYPE "ConsentLanguage" AS ENUM ('tr', 'ru', 'tg');

CREATE TABLE "consent_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "procedure_type" "ConsentProcedureType" NOT NULL,
    "language" "ConsentLanguage" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "consent_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "consent_templates_tenant_proc_lang_ver_key"
  ON "consent_templates"("tenant_id", "procedure_type", "language", "version");
CREATE INDEX "consent_templates_tenant_active_idx"
  ON "consent_templates"("tenant_id", "procedure_type", "language", "is_active");
CREATE INDEX "consent_templates_tenant_deleted_idx"
  ON "consent_templates"("tenant_id", "deleted_at");

ALTER TABLE "consent_templates"
  ADD CONSTRAINT "consent_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consent_templates"
  ADD CONSTRAINT "consent_templates_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "consent_signings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "surgery_id" UUID,
    "language" "ConsentLanguage" NOT NULL,
    "content_snapshot" TEXT NOT NULL,
    "signature_data" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signed_by_user_id" UUID,
    "witness_name" VARCHAR(200),
    "ip_address" VARCHAR(45),
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consent_signings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consent_signings_tenant_patient_signed_idx"
  ON "consent_signings"("tenant_id", "patient_id", "signed_at" DESC);
CREATE INDEX "consent_signings_tenant_surgery_idx"
  ON "consent_signings"("tenant_id", "surgery_id");
CREATE INDEX "consent_signings_tenant_template_idx"
  ON "consent_signings"("tenant_id", "template_id");

ALTER TABLE "consent_signings"
  ADD CONSTRAINT "consent_signings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consent_signings"
  ADD CONSTRAINT "consent_signings_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "consent_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consent_signings"
  ADD CONSTRAINT "consent_signings_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consent_signings"
  ADD CONSTRAINT "consent_signings_surgery_id_fkey"
  FOREIGN KEY ("surgery_id") REFERENCES "surgeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "consent_signings"
  ADD CONSTRAINT "consent_signings_signed_by_user_id_fkey"
  FOREIGN KEY ("signed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (NULL-safe — same pattern as pre_ops / iol_lots / lab_tests / patient_photos)
ALTER TABLE "consent_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "consent_templates_tenant_isolation" ON "consent_templates"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "consent_signings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent_signings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "consent_signings_tenant_isolation" ON "consent_signings"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
