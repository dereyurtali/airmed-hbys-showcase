-- #1093 — F6 bakım modu + duyuru (broadcast). İkisi de RLS-dışı platform
-- tablosu (tenant_id yok / hedef liste kolonu). airmed_app GRANT rol-guard'lı.

CREATE TABLE "maintenance_windows" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(10) NOT NULL,
    "target_tenant_id" UUID,
    "message" VARCHAR(500) NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "maintenance_windows_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "maintenance_windows_starts_at_ends_at_idx" ON "maintenance_windows"("starts_at", "ends_at");
CREATE INDEX "maintenance_windows_target_tenant_id_idx" ON "maintenance_windows"("target_tenant_id");

CREATE TABLE "platform_announcements" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "severity" VARCHAR(10) NOT NULL DEFAULT 'info',
    "scope" VARCHAR(10) NOT NULL,
    "target_tenant_ids" UUID[],
    "publish_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_announcements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_announcements_publish_at_expires_at_idx" ON "platform_announcements"("publish_at", "expires_at");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "maintenance_windows" TO airmed_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_announcements" TO airmed_app';
  END IF;
END$$;
