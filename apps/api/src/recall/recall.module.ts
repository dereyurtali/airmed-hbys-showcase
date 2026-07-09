import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { RecallService } from './recall.service';

// S15-PR20 — Recall module. Post-op takip kayıp hastalar + telefon/SMS deneme.
@Module({
  imports: [TenantModule],
  providers: [RecallService],
  exports: [RecallService],
})
export class RecallModule {}
