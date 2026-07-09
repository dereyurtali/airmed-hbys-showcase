import { Module } from '@nestjs/common';
import { PublicMonitorController } from './public-monitor.controller';
import { PublicMonitorService } from './public-monitor.service';

// #1159 — Lobi bekleme ekranı PUBLIC read modülü. AdminPrismaService global
// provider (PrismaModule) üzerinden inject edilir.
@Module({
  controllers: [PublicMonitorController],
  providers: [PublicMonitorService],
})
export class PublicMonitorModule {}
