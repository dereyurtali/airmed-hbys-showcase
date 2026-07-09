import { Module } from '@nestjs/common';
import { ClinicalListService } from './clinical-list.service';

// R1 (#723) — Kalıcı klinik problem + ilaç listesi (EHR problem list).
@Module({
  providers: [ClinicalListService],
  exports: [ClinicalListService],
})
export class ClinicalListModule {}
