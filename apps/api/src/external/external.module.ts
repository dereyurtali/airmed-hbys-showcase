import { Module } from '@nestjs/common';
import { ApiKeyModule } from '../api-key/api-key.module';
import { AuditModule } from '../audit/audit.module';
import { ExternalController } from './external.controller';

@Module({
  imports: [ApiKeyModule, AuditModule],
  controllers: [ExternalController],
})
export class ExternalModule {}
