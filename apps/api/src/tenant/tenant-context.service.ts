import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { Prisma } from '@airmed/db';

const TENANT_KEY = 'tenantId';
const TX_KEY = 'tx';

// Use Prisma's own transaction-callback type so any new $* methods added in
// future Prisma releases are automatically reflected (Omit lists go stale).
export type TenantPrismaClient = Prisma.TransactionClient;

@Injectable()
export class TenantContextService {
  constructor(private readonly cls: ClsService) {}

  setTenantId(tenantId: string): void {
    this.cls.set(TENANT_KEY, tenantId);
  }

  getTenantId(): string | undefined {
    return this.cls.get<string | undefined>(TENANT_KEY);
  }

  requireTenantId(): string {
    const id = this.getTenantId();
    if (!id) throw new Error('Tenant context not set');
    return id;
  }

  setTransaction(tx: TenantPrismaClient): void {
    this.cls.set(TX_KEY, tx);
  }

  getTransaction(): TenantPrismaClient | undefined {
    return this.cls.get<TenantPrismaClient | undefined>(TX_KEY);
  }
}
