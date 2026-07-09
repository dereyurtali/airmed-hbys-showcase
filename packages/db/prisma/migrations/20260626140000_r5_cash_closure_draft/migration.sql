-- R5 (#727) — Kasa kapatma 2-aşama: yönetici asistanı kapatma TASLAĞI hazırlar
-- (status='draft'), yönetici/finans FINALIZE eder (status='finalized'). Mevcut
-- satırlar + direkt kapatmalar 'finalized'. Draft payment/refund bağlamaz;
-- finalize closed_by/closed_at set eder + açık tahsilatları bağlar. closed_by
-- artık nullable (draft'ta kapatan yok) → FK SET NULL'a güncellenir.

-- CreateEnum
CREATE TYPE "CashClosureStatus" AS ENUM ('draft', 'finalized');

-- DropForeignKey
ALTER TABLE "cash_register_closures" DROP CONSTRAINT "cash_register_closures_closed_by_id_fkey";

-- AlterTable
ALTER TABLE "cash_register_closures" ADD COLUMN     "prepared_at" TIMESTAMP(3),
ADD COLUMN     "prepared_by_id" UUID,
ADD COLUMN     "status" "CashClosureStatus" NOT NULL DEFAULT 'finalized',
ALTER COLUMN "closed_at" DROP NOT NULL,
ALTER COLUMN "closed_by_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "cash_register_closures_tenant_id_status_idx" ON "cash_register_closures"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "cash_register_closures" ADD CONSTRAINT "cash_register_closures_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_register_closures" ADD CONSTRAINT "cash_register_closures_prepared_by_id_fkey" FOREIGN KEY ("prepared_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
