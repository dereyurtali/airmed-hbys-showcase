-- AlterTable
ALTER TABLE "platform_admins" ADD COLUMN     "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "password_changed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "platform_admin_sessions" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(64) NOT NULL,
    "ip_address" INET NOT NULL,
    "user_agent" VARCHAR(500),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_login_attempts" (
    "id" BIGSERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "ip_address" INET NOT NULL,
    "success" BOOLEAN NOT NULL,
    "failure_reason" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_ip_allowlist" (
    "id" UUID NOT NULL,
    "cidr" VARCHAR(43) NOT NULL,
    "label" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_ip_allowlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_recovery_codes" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "admin_id" UUID,
    "email" VARCHAR(255),
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100),
    "entity_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ip" INET,
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_sessions_refresh_token_hash_key" ON "platform_admin_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "platform_admin_sessions_admin_id_idx" ON "platform_admin_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "platform_admin_sessions_expires_at_idx" ON "platform_admin_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "platform_admin_login_attempts_email_created_at_idx" ON "platform_admin_login_attempts"("email", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_admin_login_attempts_ip_address_created_at_idx" ON "platform_admin_login_attempts"("ip_address", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_admin_ip_allowlist_is_active_idx" ON "platform_admin_ip_allowlist"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_recovery_codes_code_hash_key" ON "platform_admin_recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "platform_admin_recovery_codes_admin_id_used_at_idx" ON "platform_admin_recovery_codes"("admin_id", "used_at");

-- CreateIndex
CREATE INDEX "platform_audit_logs_admin_id_created_at_idx" ON "platform_audit_logs"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_audit_logs_action_created_at_idx" ON "platform_audit_logs"("action", "created_at");

-- AddForeignKey
ALTER TABLE "platform_admin_sessions" ADD CONSTRAINT "platform_admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_admin_recovery_codes" ADD CONSTRAINT "platform_admin_recovery_codes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
