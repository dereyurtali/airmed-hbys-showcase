import { Module } from '@nestjs/common';
import { LeadService } from './lead.service';

@Module({
  providers: [LeadService],
  exports: [LeadService],
})
export class LeadModule {}
