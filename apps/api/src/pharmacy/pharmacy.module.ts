import { Module } from '@nestjs/common';
import { DrugInteractionService } from './drug-interaction.service';
import { PharmacyService } from './pharmacy.service';

// S15-PR4 — DrugInteractionService: reçete + hasta tıbbi bilgileri ↔
// 50 oftalmoloji etkileşim seed kataloğu. PharmacyService'den ayrı,
// stateless lookup (DB-less).
@Module({
  providers: [PharmacyService, DrugInteractionService],
  exports: [PharmacyService, DrugInteractionService],
})
export class PharmacyModule {}
