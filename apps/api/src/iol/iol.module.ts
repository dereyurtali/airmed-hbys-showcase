import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { IolForecastService } from './iol-forecast.service';
import { IolService } from './iol.service';
import { SurgicalKitService } from './surgical-kit.service';

// D1 PR 2 — createLot → LENS_ARRIVAL_NOTICE iç bildirim (stok personeli).
// S15-PR22 — IolForecastService eklendi.
// S15-PR25 — SurgicalKitService eklendi.
@Module({
  imports: [MessagingModule],
  providers: [IolService, IolForecastService, SurgicalKitService],
  exports: [IolService, IolForecastService, SurgicalKitService],
})
export class IolModule {}
