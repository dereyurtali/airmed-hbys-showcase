import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import { TenantContextService, type TenantPrismaClient } from '../tenant/tenant-context.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly tenantContext: TenantContextService) {
    const url = process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL;
    super({ datasources: { db: { url } } });
  }

  // #969 — tenant status (active/suspended/deleted) her authenticated istekte
  // sorgulanıyordu (REST interceptor + tRPC protectedProcedure ayrı ayrı) →
  // per-request DB round-trip. Kısa TTL'li in-memory cache: suspend/delete
  // gecikmesi ≤ TTL (kabul edilebilir). Cache tenant sayısı kadar büyür (klinik-
  // primary'de birkaç kayıt). Süre dolunca yeniden çekilir.
  private readonly tenantStatusCache = new Map<
    string,
    { value: TenantStatusRow | null; at: number }
  >();

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * #969 — Cache'li tenant status okuma. REST interceptor + tRPC
   * protectedProcedure ikisi de bunu kullanır → per-request findUnique kalkar.
   * `null` = tenant yok. Suspend/delete anında yansımaz (max TENANT_STATUS_TTL_MS
   * gecikme); platform suspend akışı `invalidateTenantStatus` çağırabilir.
   */
  async getTenantStatusCached(tenantId: string): Promise<TenantStatusRow | null> {
    const now = Date.now();
    const cached = this.tenantStatusCache.get(tenantId);
    if (cached && now - cached.at < TENANT_STATUS_TTL_MS) {
      return cached.value;
    }
    const tenant = await this.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, suspendedAt: true, deletedAt: true },
    });
    this.tenantStatusCache.set(tenantId, { value: tenant, at: now });
    return tenant;
  }

  /** Suspend/delete sonrası anında etki için cache'i düşür (opsiyonel). */
  invalidateTenantStatus(tenantId: string): void {
    this.tenantStatusCache.delete(tenantId);
  }

  /**
   * Tenant-scoped client: returns the request's transactional client (set by
   * TenantInterceptor) when present, otherwise the raw root client. Use this
   * for all per-tenant queries — RLS is enforced via SET LOCAL in the
   * interceptor's transaction.
   */
  get scoped(): TenantPrismaClient {
    return this.tenantContext.getTransaction() ?? this;
  }

  /**
   * Run a callback inside a tenant-scoped transaction. Sets app.current_tenant_id
   * on the connection so RLS policies can see the tenant. Used by the interceptor
   * AND by AuthService.login for the bootstrap user lookup.
   *
   * The tenantId must be a UUID; we sanity-check before the round trip and use a
   * parameterised set_config(... , true) call so an interpolated tenantId can
   * never become the SQL string. This is RLS's only entry point — defense in
   * depth matters.
   */
  async runWithTenant<T>(tenantId: string, fn: (tx: TenantPrismaClient) => Promise<T>): Promise<T> {
    if (!UUID_REGEX.test(tenantId)) {
      throw new Error(`runWithTenant: invalid tenantId "${tenantId}"`);
    }
    // RLS'in bedeli: tüm handler bu transaction içinde koşar, yani her istek
    // yanıt dönene kadar bir DB bağlantısı + açık transaction tutar. Eşzamanlılık
    // tavanı = bağlantı havuzu boyutu (DATABASE_URL_APP `connection_limit`).
    // Prisma default'u 5sn timeout / 2sn maxWait; burada explicit + env ile
    // ayarlanabilir yapıyoruz ki yavaş raporlar (metric ham SQL, PDF) için LOCAL
    // node'da kod değişmeden gevşetilebilsin, ama varsayılan davranış aynı kalsın.
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return fn(tx);
      },
      { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS },
    );
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Prisma interactive transaction default'larıyla aynı (5000 / 2000); env ile
// override edilebilir. Uzun raporlama endpoint'leri için ops PRISMA_TX_TIMEOUT_MS'i
// yükseltebilir — ama yüksek değer havuzu daha uzun tutar, dikkatli ayarla.
const TX_TIMEOUT_MS = Number(process.env.PRISMA_TX_TIMEOUT_MS ?? 5_000);
const TX_MAX_WAIT_MS = Number(process.env.PRISMA_TX_MAX_WAIT_MS ?? 2_000);

// #969 — tenant status cache TTL (ms). Kısa tut (suspend/delete gecikmesi = TTL).
const TENANT_STATUS_TTL_MS = Number(process.env.TENANT_STATUS_CACHE_TTL_MS ?? 30_000);

type TenantStatusRow = {
  status: string;
  suspendedAt: Date | null;
  deletedAt: Date | null;
};
