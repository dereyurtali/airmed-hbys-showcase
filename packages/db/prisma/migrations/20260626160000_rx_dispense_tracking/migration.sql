-- #790 — Reçete dispense-tracking: eczacı POS'ta dağıttıkça durum işaretler,
-- her satış kalemi hangi reçete kalemini karşıladığını (muadil/kısmi audit) taşır.
-- Klinik-güvenlik: otomatik isim-eşleştirme YOK; eczacı her kalemi manuel eşler.

-- CreateEnum
CREATE TYPE "PrescriptionDispenseStatus" AS ENUM ('pending', 'partial', 'dispensed');

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "dispense_status" "PrescriptionDispenseStatus" NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE "pharmacy_sale_items" ADD COLUMN     "prescription_item_label" VARCHAR(200);
