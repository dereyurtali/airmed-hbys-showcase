import { Module } from '@nestjs/common';
import { PermissionMatrixService } from './permission.service';

@Module({
  providers: [PermissionMatrixService],
  exports: [PermissionMatrixService],
})
export class PermissionMatrixModule {}
