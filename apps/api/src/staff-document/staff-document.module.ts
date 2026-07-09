import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { StaffDocumentController } from './staff-document.controller';
import { StaffDocumentService } from './staff-document.service';

// #1049 — Personel dökümanları (CV/diploma/sertifika/sözleşme).
@Module({
  imports: [StorageModule],
  controllers: [StaffDocumentController],
  providers: [StaffDocumentService],
  exports: [StaffDocumentService],
})
export class StaffDocumentModule {}
