import { Module } from '@nestjs/common';
import { ConsumableService } from './consumable.service';

// #372 — Consumable (genel sarf/ilaç stok) CRUD + tüketim düşümü.
@Module({
  providers: [ConsumableService],
  exports: [ConsumableService],
})
export class ConsumableModule {}
