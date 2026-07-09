import { Module } from '@nestjs/common';
import { PlatformAuthModule } from '../auth/platform-auth.module';
import { PlatformSecurityController } from './platform-security.controller';
import { PlatformSecurityService } from './platform-security.service';

@Module({
  imports: [PlatformAuthModule],
  controllers: [PlatformSecurityController],
  providers: [PlatformSecurityService],
})
export class PlatformSecurityModule {}
