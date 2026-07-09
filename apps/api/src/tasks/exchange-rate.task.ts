import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { fetchNbtUsdRate } from '../billing/nbt.provider';

// #419b — NBT günlük USD→TJS kuru çekme cron'u. Kur global → bir kez çekilir,
// her aktif tenant'a yazılır (no-show/fraud-scan ile aynı per-tenant pattern).
// Offline/parse hatasında HİÇBİR ŞEY yazılmaz → son-bilinen kur korunur; fatura
// snapshot'ı RatesService.snapshotRateToTjs ile yine kesilebilir (fallback 11).

@Injectable()
export class ExchangeRateTask {
  private readonly logger = new Logger(ExchangeRateTask.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  // Her gün 06:00 Duşanbe (NBT günlük kuru sabah yayınlar).
  @Cron('0 6 * * *', { name: 'exchange-rate-nbt', timeZone: 'Asia/Dushanbe' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.refresh();
      this.logger.log(
        `exchange-rate-nbt: ${result.status} rate=${result.rate ?? '—'} tenants=${result.written}`,
      );
    } catch (err) {
      this.logger.error(`exchange-rate-nbt tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async refresh(): Promise<{ status: string; rate: number | null; written: number }> {
    const asOf = new Date();
    const rate = await fetchNbtUsdRate(asOf.toISOString().slice(0, 10));
    if (rate == null) {
      // Offline/parse fail — son-bilinen kuru koru, sessizce atla.
      return { status: 'skipped-no-rate', rate: null, written: 0 };
    }
    const decimal = new Prisma.Decimal(rate.toFixed(4));
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'active', deletedAt: null },
      select: { id: true },
    });
    let written = 0;
    for (const t of tenants) {
      try {
        await this.prisma.runWithTenant(t.id, async (tx) => {
          await tx.exchangeRate.create({
            data: {
              tenantId: t.id,
              baseCurrency: 'USD',
              quoteCurrency: 'TJS',
              rate: decimal,
              asOf,
              source: 'nbt',
            },
          });
        });
        written++;
      } catch (err) {
        this.logger.warn(
          `exchange-rate write failed for tenant ${t.id}: ${(err as Error).message}`,
        );
      }
    }
    return { status: 'ok', rate, written };
  }
}
