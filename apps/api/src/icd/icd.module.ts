import { Module } from '@nestjs/common';
import { IcdService } from './icd.service';

@Module({
  providers: [IcdService],
  exports: [IcdService],
})
export class IcdModule {}
