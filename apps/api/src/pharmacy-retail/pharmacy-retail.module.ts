import { Module } from '@nestjs/common';
import { PharmacyRetailService } from './pharmacy-retail.service';

// v0.4 #552 — Eczane perakende (POS/stok/kasa/rapor) mantığı.
@Module({
  providers: [PharmacyRetailService],
  exports: [PharmacyRetailService],
})
export class PharmacyRetailModule {}
