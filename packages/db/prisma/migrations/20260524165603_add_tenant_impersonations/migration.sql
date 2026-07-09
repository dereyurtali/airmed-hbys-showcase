-- F4 — tenant_impersonations tablosu + ilişkili indexler.
-- Platform admin'in tenant kullanıcısı kimliğiyle geçici giriş kayıtları.
-- Anında revocation için DB-tracked (Redis yerine pilot için PG yeterli).

CREATE TABLE "tenant_impersonations" (
    "id" UUID NOT NULL,
    "platform_admin_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "target_tenant_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "ended_reason" VARCHAR(50),
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_impersonations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_impersonations_target_user_id_ended_at_idx" ON "tenant_impersonations"("target_user_id", "ended_at");

CREATE INDEX "tenant_impersonations_platform_admin_id_started_at_idx" ON "tenant_impersonations"("platform_admin_id", "started_at" DESC);

CREATE INDEX "tenant_impersonations_target_tenant_id_ended_at_idx" ON "tenant_impersonations"("target_tenant_id", "ended_at");

ALTER TABLE "tenant_impersonations"
  ADD CONSTRAINT "tenant_impersonations_platform_admin_id_fkey"
  FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admins"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenant_impersonations"
  ADD CONSTRAINT "tenant_impersonations_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenant_impersonations"
  ADD CONSTRAINT "tenant_impersonations_target_tenant_id_fkey"
  FOREIGN KEY ("target_tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Aynı kullanıcıya aynı anda 2 aktif impersonation olamaz — partial unique
-- index (ended_at IS NULL). Prisma partial index DDL'ini doğrudan tanımlayamıyor,
-- migration'da raw SQL ile kuruyoruz.
CREATE UNIQUE INDEX "tenant_impersonations_unique_active"
  ON "tenant_impersonations"("target_user_id")
  WHERE "ended_at" IS NULL;
