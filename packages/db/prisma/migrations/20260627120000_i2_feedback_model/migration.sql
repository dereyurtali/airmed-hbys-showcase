-- I2.1 (#818) — Geri-Bildirim Merkezi veri modeli: FeedbackRequest + FeedbackAttachment.
-- RLS tenant-scoped (mevcut pattern). Durum senkronu outbound-poll (backend cron GitHub
-- issue/PR durumunu çeker → status günceller) olduğundan sync_outbox YOK.

-- AlterEnum — NotificationType: feedback alındı + durum değişti bildirimleri
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'feature_request';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'feature_request_status';

-- CreateTable
CREATE TABLE "feedback_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "submitted_by_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "route_path" VARCHAR(200) NOT NULL,
    "app_version" VARCHAR(40) NOT NULL,
    "context_json" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'submitted',
    "github_issue_no" INTEGER,
    "shipped_version" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "feedback_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_attachments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "feedback_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_requests_tenant_id_submitted_by_id_created_at_idx" ON "feedback_requests"("tenant_id", "submitted_by_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "feedback_attachments_tenant_id_request_id_idx" ON "feedback_attachments"("tenant_id", "request_id");

-- AddForeignKey
ALTER TABLE "feedback_requests" ADD CONSTRAINT "feedback_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_requests" ADD CONSTRAINT "feedback_requests_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "feedback_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS — tenant izolasyonu (mevcut pattern; app.current_tenant_id GUC)
-- =============================================================================
ALTER TABLE "feedback_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feedback_requests_tenant_isolation" ON "feedback_requests"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "feedback_attachments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feedback_attachments_tenant_isolation" ON "feedback_attachments"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- =============================================================================
-- airmed_app role GRANT. Rol yoksa atla (fresh DB / CI guard, 42704'ü önle).
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "feedback_requests", "feedback_attachments" TO airmed_app';
  END IF;
END$$;
