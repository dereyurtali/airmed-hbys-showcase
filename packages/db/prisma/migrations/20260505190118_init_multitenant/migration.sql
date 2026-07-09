-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'trial', 'suspended', 'churned');

-- CreateEnum
CREATE TYPE "TenantPlan" AS ENUM ('pilot', 'standard', 'enterprise');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('platform_owner', 'platform_engineer', 'platform_support');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "plan" "TenantPlan" NOT NULL DEFAULT 'pilot',
    "locale" VARCHAR(5) NOT NULL DEFAULT 'tr',
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Dushanbe',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "feature_flags" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspended_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "totp_secret" VARCHAR(64),
    "totp_verified_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" INET,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_markers" (
    "id" UUID NOT NULL,
    "service" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_markers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_slug_idx" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");
