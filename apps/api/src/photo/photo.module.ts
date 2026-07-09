import { Module } from '@nestjs/common';
import { PhotoController } from './photo.controller';
import { PhotoService } from './photo.service';

// S15-PR2 — StorageService artık global StorageModule provider'ı (app.module
// imports'a eklendi). Photo modülü tüketici; provider tekrarı yok.
@Module({
  controllers: [PhotoController],
  providers: [PhotoService],
  exports: [PhotoService],
})
export class PhotoModule {}
