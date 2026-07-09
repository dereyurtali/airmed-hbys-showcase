/*
  Warnings:

  - You are about to drop the `health_markers` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'locked', 'inactive');

-- CreateEnum
CREATE TYPE "RoleKey" AS ENUM ('yonetici', 'yonetici_asistani', 'doktor', 'resepsiyon', 'hemsire');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "DoctorType" AS ENUM ('local', 'visiting', 'referral');

-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('consultation', 'surgery', 'control', 'injection', 'laser');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('scheduled', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "SurgeryStatus" AS ENUM ('planned', 'performed', 'cancelled', 'postponed');

-- CreateEnum
CREATE TYPE "MeasurementType" AS ENUM ('visual_acuity', 'intraocular_pressure', 'refraction', 'biometry', 'keratometry', 'topography', 'pachymetry', 'perimetry', 'fundus_photo', 'oct');

-- DropTable
DROP TABLE "health_markers";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'tr',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" INET,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" "RoleKey" NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("tenant_id","user_id","role_id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "ip" INET,
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "mrn" VARCHAR(20) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "birth_date" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "identity_no" VARCHAR(50),
    "passport_no" VARCHAR(50),
    "phone" VARCHAR(20),
    "phone_last4" VARCHAR(4),
    "email" VARCHAR(255),
    "address" TEXT,
    "emergency_contact_name" VARCHAR(200),
    "emergency_contact_phone" VARCHAR(20),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "specialty" VARCHAR(100) NOT NULL,
    "type" "DoctorType" NOT NULL DEFAULT 'local',
    "contact_phone" VARCHAR(20),
    "contact_email" VARCHAR(255),
    "commission_rate" DECIMAL(5,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_availabilities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_availabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "type" "AppointmentType" NOT NULL DEFAULT 'consultation',
    "status" "AppointmentStatus" NOT NULL DEFAULT 'scheduled',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "examinations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "appointment_id" UUID,
    "chief_complaint" TEXT,
    "history" TEXT,
    "findings" JSONB NOT NULL DEFAULT '{}',
    "diagnosis" TEXT,
    "treatment_plan" TEXT,
    "prescription" TEXT,
    "examined_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "examinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgeries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "appointment_id" UUID,
    "type" VARCHAR(100) NOT NULL,
    "status" "SurgeryStatus" NOT NULL DEFAULT 'planned',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "performed_at" TIMESTAMP(3),
    "pre_op" JSONB NOT NULL DEFAULT '{}',
    "intra_op" JSONB NOT NULL DEFAULT '{}',
    "post_op" JSONB NOT NULL DEFAULT '{}',
    "complication_flag" BOOLEAN NOT NULL DEFAULT false,
    "complication_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "surgeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "type" "MeasurementType" NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "measured_at" TIMESTAMP(3) NOT NULL,
    "measured_by_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100),
    "entity_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ip" INET,
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_tenant_id_status_idx" ON "users"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "users_tenant_id_deleted_at_idx" ON "users"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "roles_tenant_id_is_active_idx" ON "roles"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_key_key" ON "roles"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "user_roles_tenant_id_user_id_idx" ON "user_roles"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "user_roles_tenant_id_role_id_idx" ON "user_roles"("tenant_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_tenant_id_user_id_idx" ON "refresh_tokens"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_tenant_id_expires_at_idx" ON "refresh_tokens"("tenant_id", "expires_at");

-- CreateIndex
CREATE INDEX "patients_tenant_id_last_name_first_name_idx" ON "patients"("tenant_id", "last_name", "first_name");

-- CreateIndex
CREATE INDEX "patients_tenant_id_phone_last4_idx" ON "patients"("tenant_id", "phone_last4");

-- CreateIndex
CREATE INDEX "patients_tenant_id_deleted_at_idx" ON "patients"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "patients_tenant_id_mrn_key" ON "patients"("tenant_id", "mrn");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_user_id_key" ON "doctors"("user_id");

-- CreateIndex
CREATE INDEX "doctors_tenant_id_is_active_idx" ON "doctors"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "doctors_tenant_id_specialty_idx" ON "doctors"("tenant_id", "specialty");

-- CreateIndex
CREATE INDEX "doctor_availabilities_tenant_id_doctor_id_day_of_week_idx" ON "doctor_availabilities"("tenant_id", "doctor_id", "day_of_week");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_doctor_id_starts_at_idx" ON "appointments"("tenant_id", "doctor_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_patient_id_starts_at_idx" ON "appointments"("tenant_id", "patient_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_status_starts_at_idx" ON "appointments"("tenant_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_deleted_at_idx" ON "appointments"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "examinations_appointment_id_key" ON "examinations"("appointment_id");

-- CreateIndex
CREATE INDEX "examinations_tenant_id_patient_id_examined_at_idx" ON "examinations"("tenant_id", "patient_id", "examined_at");

-- CreateIndex
CREATE INDEX "examinations_tenant_id_doctor_id_examined_at_idx" ON "examinations"("tenant_id", "doctor_id", "examined_at");

-- CreateIndex
CREATE UNIQUE INDEX "surgeries_appointment_id_key" ON "surgeries"("appointment_id");

-- CreateIndex
CREATE INDEX "surgeries_tenant_id_patient_id_scheduled_at_idx" ON "surgeries"("tenant_id", "patient_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "surgeries_tenant_id_doctor_id_scheduled_at_idx" ON "surgeries"("tenant_id", "doctor_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "surgeries_tenant_id_status_idx" ON "surgeries"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "measurements_tenant_id_patient_id_measured_at_idx" ON "measurements"("tenant_id", "patient_id", "measured_at");

-- CreateIndex
CREATE INDEX "measurements_tenant_id_type_measured_at_idx" ON "measurements"("tenant_id", "type", "measured_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_user_id_created_at_idx" ON "audit_logs"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_availabilities" ADD CONSTRAINT "doctor_availabilities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_availabilities" ADD CONSTRAINT "doctor_availabilities_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgeries" ADD CONSTRAINT "surgeries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgeries" ADD CONSTRAINT "surgeries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgeries" ADD CONSTRAINT "surgeries_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgeries" ADD CONSTRAINT "surgeries_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_measured_by_id_fkey" FOREIGN KEY ("measured_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
