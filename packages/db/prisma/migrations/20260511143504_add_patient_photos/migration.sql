-- CreateEnum
CREATE TYPE "PhotoTag" AS ENUM ('preop', 'postop', 'intraop', 'oct', 'fundus', 'topography', 'general');

-- DropForeignKey
ALTER TABLE "doctor_leaves" DROP CONSTRAINT "doctor_leaves_tenant_id_fkey";

-- AlterTable
ALTER TABLE "doctor_leaves" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "patient_photos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "uploaded_by_id" UUID,
    "tag" "PhotoTag" NOT NULL DEFAULT 'general',
    "description" VARCHAR(500),
    "file_name" VARCHAR(255) NOT NULL,
    "file_key" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "taken_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patient_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_photos_tenant_id_patient_id_created_at_idx" ON "patient_photos"("tenant_id", "patient_id", "created_at");

-- CreateIndex
CREATE INDEX "patient_photos_tenant_id_tag_created_at_idx" ON "patient_photos"("tenant_id", "tag", "created_at");

-- CreateIndex
CREATE INDEX "patient_photos_tenant_id_deleted_at_idx" ON "patient_photos"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "patient_photos_tenant_id_file_key_key" ON "patient_photos"("tenant_id", "file_key");

-- AddForeignKey
ALTER TABLE "doctor_leaves" ADD CONSTRAINT "doctor_leaves_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_photos" ADD CONSTRAINT "patient_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_photos" ADD CONSTRAINT "patient_photos_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_photos" ADD CONSTRAINT "patient_photos_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
