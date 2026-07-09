import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import { adminDatabaseUrl } from './admin-datasource';

/**
 * #1057/#1065 — Paylaşımlı RLS-bypass (cross-tenant) Prisma client'ı.
 *
 * Repoda her cross-tenant servis kendi `new PrismaClient({ url: adminDatabaseUrl() })`
 * instance'ını açıyordu (14+ instance × kendi bağlantı havuzu). Bu servis tek
 * instance / tek havuz sunar; yeni cross-tenant ihtiyaçlar bunu inject etmeli,
 * yeni PrismaClient AÇMAMALI.
 *
 * GÜVENLİK: Bu client RLS'i bypass eder (airmed_bg BYPASSRLS / superuser
 * fallback). YALNIZ platform-admin auth'lu controller'lar veya background
 * worker'lar arkasında kullanılabilir; tenant-facing istek yoluna sızdırma.
 */
@Injectable()
export class AdminPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ datasources: { db: { url: adminDatabaseUrl() } } });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
