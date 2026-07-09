import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * S15-PR2 — StorageService'i global bir modüle çıkardık. Önceden sadece
 * PhotoModule içindeydi; Patient profil foto + Lab dosya + ileride consent
 * imza arşivi için ortak. Stateless + ConfigService bağımlısı.
 *
 * PhotoModule + LabModule mevcut import'larını korur (geriye dönük uyumlu;
 * Photo/Lab modülü kendi içinde de aynı service'i provider olarak tutmaya
 * devam edebilir ya da bu global'i tüketir — bu PR'da yalnız taşıma).
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
