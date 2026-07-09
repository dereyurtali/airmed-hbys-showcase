import { Module } from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service';

// v0.4 #549 — Satın Alma Siparişi (PO) yaşam döngüsü + onay + mal kabul.
@Module({
  providers: [PurchaseOrderService],
  exports: [PurchaseOrderService],
})
export class PurchaseOrderModule {}
