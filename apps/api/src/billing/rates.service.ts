import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// #419 — Döviz kuru servisi. Tenant-scoped exchange_rates tablosundan en güncel
// base→quote kurunu okur (NBT cron'unun #419b'de dolduracağı tablo). Kayıt yoksa
// legacy fallback (USD→TJS = 11) döner; fatura yine kesilebilsin (offline-safe).
export const DEFAULT_USD_TJS_RATE = new Prisma.Decimal(11);

@Injectable()
export class RatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** En güncel base→quote kuru; kayıt yoksa null. */
  async getCurrentRate(base: string, quote: string): Promise<Prisma.Decimal | null> {
    const row = await this.prisma.scoped.exchangeRate.findFirst({
      where: { baseCurrency: base, quoteCurrency: quote },
      orderBy: { asOf: 'desc' },
      select: { rate: true },
    });
    return row?.rate ?? null;
  }

  /**
   * Fatura kesim-anı snapshot kuru: TJS fatura = 1; aksi halde base→TJS güncel
   * kur, yoksa legacy fallback. Para hatasında fatura bloklanmaz.
   */
  async snapshotRateToTjs(currency: 'TJS' | 'USD'): Promise<Prisma.Decimal> {
    if (currency === 'TJS') return new Prisma.Decimal(1);
    return (await this.getCurrentRate(currency, 'TJS')) ?? DEFAULT_USD_TJS_RATE;
  }

  /** Frontend için güncel USD→TJS kuru (PaymentDialog hardcoded 11.00 yerine). */
  async currentUsdTjs(): Promise<{ rate: string; asOf: Date; source: string } | null> {
    const row = await this.prisma.scoped.exchangeRate.findFirst({
      where: { baseCurrency: 'USD', quoteCurrency: 'TJS' },
      orderBy: { asOf: 'desc' },
      select: { rate: true, asOf: true, source: true },
    });
    return row ? { rate: row.rate.toFixed(4), asOf: row.asOf, source: row.source } : null;
  }
}
