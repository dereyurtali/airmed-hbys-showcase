import { Module } from '@nestjs/common';
import { PlatformAuthModule } from '../auth/platform-auth.module';
import { PlatformAiController } from './platform-ai.controller';
import { PlatformAiService } from './platform-ai.service';

@Module({
  imports: [PlatformAuthModule],
  controllers: [PlatformAiController],
  providers: [PlatformAiService],
})
export class PlatformAiModule {}
