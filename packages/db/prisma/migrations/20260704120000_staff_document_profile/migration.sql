-- #1049 — Personel profil katmanı (EPIC #1052):
--   1. StaffDocument (CV/diploma/sertifika/sözleşme) — çift nullable FK
--      (user_id + doctor_id, en az biri dolu; login'siz doktorlar kapsanır).
--   2. Doctor hasta-facing profil alanları (title/photo_key/bio/languages/
--      public_profile) — KVKK amaç ayrımı: dökümanlar İK verisi, hasta
--      yüzeyine yalnız public_profile=true iken profil alanları çıkar.
--   3. User.phone (personel telefonu).

-- CreateEnum
CREATE TYPE "StaffDocType" AS ENUM ('cv', 'diploma', 'sertifika', 'sozlesme', 'diger');

-- AlterTable — users
ALTER TABLE "users" ADD COLUMN "phone" VARCHAR(30);

-- AlterTable — doctors (hepsi nullable/default'lu → rewrite yok, prod-güvenli)
ALTER TABLE "doctors" ADD COLUMN "title" VARCHAR(100);
ALTER TABLE "doctors" ADD COLUMN "photo_key" VARCHAR(255);
ALTER TABLE "doctors" ADD COLUMN "bio" JSONB;
ALTER TABLE "doctors" ADD COLUMN "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "doctors" ADD COLUMN "public_profile" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "staff_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "doctor_id" UUID,
    "doc_type" "StaffDocType" NOT NULL,
    "file_key" VARCHAR(255) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "note" VARCHAR(500),
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "staff_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_documents_tenant_id_file_key_key" ON "staff_documents"("tenant_id", "file_key");
CREATE INDEX "staff_documents_tenant_id_user_id_idx" ON "staff_documents"("tenant_id", "user_id");
CREATE INDEX "staff_documents_tenant_id_doctor_id_idx" ON "staff_documents"("tenant_id", "doctor_id");

-- AddForeignKey
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Çift-FK kuralı: en az bir özne dolu. Prisma CHECK constraint'i modellemez
-- (appointments_no_overlap EXCLUDE deseniyle aynı) → şemadan üretilen sonraki
-- migration'lar bunu drop planına ALMAZ (#959 dersi index'ler içindi; CHECK
-- prisma diff'inde görünmez).
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_subject_check"
  CHECK ("user_id" IS NOT NULL OR "doctor_id" IS NOT NULL);

-- =============================================================================
-- RLS — tenant izolasyonu (mevcut pattern; app.current_tenant_id GUC)
-- =============================================================================
ALTER TABLE "staff_documents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_documents_tenant_isolation" ON "staff_documents"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- =============================================================================
-- airmed_app role GRANT. Rol yoksa atla (fresh DB / CI guard, 42704'ü önle).
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "staff_documents" TO airmed_app';
  END IF;
END$$;

-- =============================================================================
-- sync_outbox — A12 hibrit sync (mevcut trigger fonksiyonu)
-- =============================================================================
CREATE TRIGGER staff_documents_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON "staff_documents"
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('staff_document');
