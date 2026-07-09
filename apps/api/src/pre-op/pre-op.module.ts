import { Module } from '@nestjs/common';
import { IolModule } from '../iol/iol.module';
import { PreOpService } from './pre-op.service';

// #364 — IolModule: PreOp lens seçimi IolService.reserve() çağırır (available→
// reserved); lens değişiminde önceki rezervasyon release edilir.
@Module({
  imports: [IolModule],
  providers: [PreOpService],
  exports: [PreOpService],
})
export class PreOpModule {}
