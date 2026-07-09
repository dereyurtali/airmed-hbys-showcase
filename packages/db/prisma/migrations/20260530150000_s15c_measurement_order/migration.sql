-- S15c — MeasurementOrder (ölçüm sipariş akışı).
--
-- Doktor ölçüm ister → (ücretliyse) hasta kasaya → ödeme sonrası ölçüm odası →
-- sonuçlar doktora döner. Measurement.measurement_order_id fulfilled sonuçları
-- siparişe bağlar. requires_payment: service_item_ids dolu mu (ücretli ölçüm).

-- CreateEnum
CREATE TYPE "MeasurementOrderStatus" AS ENUM ('requested', 'awaiting_payment', 'in_progress', 'fulfilled', 'cancelled');

-- AlterTable
ALTER TABLE "measurements" ADD COLUMN "measurement_order_id" UUID;

-- CreateTable
CREATE TABLE "measurement_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID,
    "patient_id" UUID NOT NULL,
    "ordered_by_id" UUID NOT NULL,
    "doctor_id" UUID,
    "requested_types" "MeasurementType"[],
    "service_item_ids" UUID[],
    "requires_payment" BOOLEAN NOT NULL DEFAULT false,
    "status" "MeasurementOrderStatus" NOT NULL DEFAULT 'requested',
    "notes" TEXT,
    "fulfilled_by_id" UUID,
    "fulfilled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "measurement_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "measurement_orders_tenant_id_status_idx" ON "measurement_orders"("tenant_id", "status");
CREATE INDEX "measurement_orders_tenant_id_doctor_id_status_idx" ON "measurement_orders"("tenant_id", "doctor_id", "status");
CREATE INDEX "measurement_orders_tenant_id_encounter_id_idx" ON "measurement_orders"("tenant_id", "encounter_id");
CREATE INDEX "measurement_orders_tenant_id_deleted_at_idx" ON "measurement_orders"("tenant_id", "deleted_at");
CREATE INDEX "measurements_tenant_id_measurement_order_id_idx" ON "measurements"("tenant_id", "measurement_order_id");

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_measurement_order_id_fkey" FOREIGN KEY ("measurement_order_id") REFERENCES "measurement_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "measurement_orders" ADD CONSTRAINT "measurement_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "measurement_orders" ADD CONSTRAINT "measurement_orders_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "measurement_orders" ADD CONSTRAINT "measurement_orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "measurement_orders" ADD CONSTRAINT "measurement_orders_ordered_by_id_fkey" FOREIGN KEY ("ordered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS — tenant izolasyonu (mevcut pattern ile birebir)
ALTER TABLE "measurement_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "measurement_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY "measurement_orders_tenant_isolation" ON "measurement_orders"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Sync outbox trigger (A12)
CREATE TRIGGER "measurement_orders_sync_outbox"
  AFTER INSERT OR UPDATE OR DELETE ON "measurement_orders"
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('measurementOrder');
