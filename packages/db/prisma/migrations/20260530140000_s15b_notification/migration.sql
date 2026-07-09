-- S15b — Notification (uygulama-içi bildirim / inbox).
--
-- İstasyonlar arası "düşme" deneyiminin bel kemiği. NotificationService satır
-- insert eder VE mevcut SyncGateway üzerinden tenant room'a `notification.new`
-- yayar; client kendi recipientUserId'sine göre filtreler.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('sent_to_doctor', 'measurement_ordered', 'measurement_payment_due', 'measurement_ready', 'surgery_handoff');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_tenant_id_recipient_user_id_read_at_idx" ON "notifications"("tenant_id", "recipient_user_id", "read_at");
CREATE INDEX "notifications_tenant_id_recipient_user_id_created_at_idx" ON "notifications"("tenant_id", "recipient_user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS — tenant izolasyonu (mevcut pattern ile birebir). Kullanıcı-içi scope
-- (recipientUserId) servis katmanında uygulanır; RLS tenant sınırını korur.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "notifications_tenant_isolation" ON "notifications"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Sync outbox trigger (A12 — hibrit sync için her tenant tablosu sync edilir)
CREATE TRIGGER "notifications_sync_outbox"
  AFTER INSERT OR UPDATE OR DELETE ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('notification');
