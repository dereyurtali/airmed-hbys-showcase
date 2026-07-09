import { Injectable } from '@nestjs/common';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';

// #1088 — Tenant kullanım & büyüme. Cross-tenant metrikler TEK sorguyla
// (groupBy tenant_id, RLS-bypass admin client) — tenant-başına döngü YASAK
// (#1057 dersi). Billing modeli KAPSAM DIŞI; salt kullanım görünürlüğü.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UsageSummary {
  activeTenants: number;
  activeUsers: number;
  appointments30d: number;
  newPatients30d: number;
}
export interface TenantUsageRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  users: number;
  patients: number;
  appointments30d: number;
  invoices30d: number;
  aiConversations30d: number;
  dbShareRows: number;
  createdAt: string;
}
export interface TrendPoint {
  weekStart: string;
  newPatients: number;
  appointments: number;
}

@Injectable()
export class PlatformUsageService {
  constructor(private readonly admin: AdminPrismaService) {}

  async summary(): Promise<UsageSummary> {
    const since = new Date(Date.now() - 30 * DAY_MS);
    const [activeTenants, activeUsers, appts, patients] = await Promise.all([
      this.admin.tenant.count({ where: { status: 'active', deletedAt: null } }),
      this.admin.user.count({ where: { status: 'active', deletedAt: null } }),
      this.admin.appointment.count({ where: { createdAt: { gte: since } } }),
      this.admin.patient.count({ where: { createdAt: { gte: since } } }),
    ]);
    return {
      activeTenants,
      activeUsers,
      appointments30d: appts,
      newPatients30d: patients,
    };
  }

  /** Tenant karşılaştırma — her metrik tek groupBy; sonra Map'te birleşir. */
  async tenants(): Promise<TenantUsageRow[]> {
    const since = new Date(Date.now() - 30 * DAY_MS);
    const [tenants, userG, patG, apptG, invG, aiG] = await Promise.all([
      this.admin.tenant.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, slug: true, status: true, createdAt: true },
        orderBy: { name: 'asc' },
      }),
      this.admin.user.groupBy({
        by: ['tenantId'],
        _count: { _all: true },
        where: { deletedAt: null },
      }),
      this.admin.patient.groupBy({
        by: ['tenantId'],
        _count: { _all: true },
        where: { deletedAt: null },
      }),
      this.admin.appointment.groupBy({
        by: ['tenantId'],
        _count: { _all: true },
        where: { createdAt: { gte: since } },
      }),
      this.admin.invoice.groupBy({
        by: ['tenantId'],
        _count: { _all: true },
        where: { createdAt: { gte: since } },
      }),
      this.admin.agentConversation.groupBy({
        by: ['tenantId'],
        _count: { _all: true },
        where: { createdAt: { gte: since } },
      }),
    ]);
    const map = (g: { tenantId: string | null; _count: { _all: number } }[]) => {
      const m = new Map<string, number>();
      for (const r of g) if (r.tenantId) m.set(r.tenantId, r._count._all);
      return m;
    };
    const users = map(userG);
    const patients = map(patG);
    const appts = map(apptG);
    const invoices = map(invG);
    const ai = map(aiG);

    return tenants.map((t) => {
      const p = patients.get(t.id) ?? 0;
      const a30 = appts.get(t.id) ?? 0;
      const i30 = invoices.get(t.id) ?? 0;
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        users: users.get(t.id) ?? 0,
        patients: p,
        appointments30d: a30,
        invoices30d: i30,
        aiConversations30d: ai.get(t.id) ?? 0,
        // DB payı yaklaşık göstergesi: büyük tabloların satır toplamı.
        dbShareRows: p + a30 + i30,
        createdAt: t.createdAt.toISOString(),
      };
    });
  }

  /** 12 haftalık yeni hasta + randevu trendi (haftalık bucket; opsiyonel tenant). */
  async trend(weeks: number, tenantId?: string): Promise<TrendPoint[]> {
    const w = Math.max(1, Math.min(52, weeks));
    const since = new Date(Date.now() - w * 7 * DAY_MS);
    const tenantFilter = tenantId ? { tenantId } : {};
    const [patients, appts] = await Promise.all([
      this.admin.patient.findMany({
        where: { createdAt: { gte: since }, ...tenantFilter, deletedAt: null },
        select: { createdAt: true },
      }),
      this.admin.appointment.findMany({
        where: { createdAt: { gte: since }, ...tenantFilter },
        select: { createdAt: true },
      }),
    ]);
    const weekMs = 7 * DAY_MS;
    const originWeek = Math.floor(since.getTime() / weekMs);
    const buckets = new Map<number, { newPatients: number; appointments: number }>();
    for (let i = 0; i < w; i++) buckets.set(originWeek + i, { newPatients: 0, appointments: 0 });
    for (const p of patients) {
      const wk = Math.floor(p.createdAt.getTime() / weekMs);
      const b = buckets.get(wk);
      if (b) b.newPatients += 1;
    }
    for (const a of appts) {
      const wk = Math.floor(a.createdAt.getTime() / weekMs);
      const b = buckets.get(wk);
      if (b) b.appointments += 1;
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([wk, v]) => ({
        weekStart: new Date(wk * weekMs).toISOString(),
        newPatients: v.newPatients,
        appointments: v.appointments,
      }));
  }
}
