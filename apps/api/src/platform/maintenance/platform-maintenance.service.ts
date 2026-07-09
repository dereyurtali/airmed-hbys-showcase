import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';

// #1093 — F6 bakım modu + duyuru. Platform admin CRUD + klinik-tarafı okuma
// yardımcıları (setup/status + announcements endpoint + bakım guard buradan
// okur). Tümü RLS-bypass admin client (platform tabloları, tenant_id yok).

export interface ActiveMaintenance {
  message: string;
  endsAt: string;
}
export interface ActiveAnnouncement {
  id: string;
  title: string;
  body: string;
  severity: string;
  dismissible: boolean;
}

@Injectable()
export class PlatformMaintenanceService {
  constructor(private readonly admin: AdminPrismaService) {}

  // ---------------- Klinik-tarafı okuma (cache'siz; guard kendi cache'ler) ----

  /** tenantId için aktif bakım penceresi (global veya eşleşen tenant). */
  async activeMaintenance(tenantId: string | null): Promise<ActiveMaintenance | null> {
    const now = new Date();
    const row = await this.admin.maintenanceWindow.findFirst({
      where: {
        cancelledAt: null,
        startsAt: { lte: now },
        endsAt: { gt: now },
        OR: [
          { scope: 'global' },
          ...(tenantId ? [{ scope: 'tenant', targetTenantId: tenantId }] : []),
        ],
      },
      orderBy: { endsAt: 'desc' },
      select: { message: true, endsAt: true },
    });
    return row ? { message: row.message, endsAt: row.endsAt.toISOString() } : null;
  }

  /** tenantId için yayında olan duyurular (global veya hedef listede). */
  async activeAnnouncements(tenantId: string | null): Promise<ActiveAnnouncement[]> {
    const now = new Date();
    const rows = await this.admin.platformAnnouncement.findMany({
      where: {
        archivedAt: null,
        publishAt: { lte: now },
        expiresAt: { gt: now },
        OR: [
          { scope: 'global' },
          ...(tenantId ? [{ scope: 'tenant', targetTenantIds: { has: tenantId } }] : []),
        ],
      },
      orderBy: { publishAt: 'desc' },
      select: { id: true, title: true, body: true, severity: true },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      severity: r.severity,
      dismissible: r.severity !== 'warning', // kritik (warning) dismiss'siz
    }));
  }

  // ---------------- Platform admin CRUD ----------------

  async listMaintenance() {
    return this.admin.maintenanceWindow.findMany({ orderBy: { startsAt: 'desc' }, take: 100 });
  }

  async createMaintenance(input: {
    scope: string;
    targetTenantId?: string | null;
    message: string;
    startsAt: string;
    endsAt: string;
    createdById?: string;
  }) {
    const starts = new Date(input.startsAt);
    const ends = new Date(input.endsAt);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || starts >= ends) {
      throw new BadRequestException('Geçersiz bakım penceresi zaman aralığı');
    }
    if (input.scope === 'tenant' && !input.targetTenantId) {
      throw new BadRequestException('tenant kapsamı için targetTenantId zorunlu');
    }
    return this.admin.maintenanceWindow.create({
      data: {
        scope: input.scope,
        targetTenantId: input.scope === 'tenant' ? input.targetTenantId : null,
        message: input.message,
        startsAt: starts,
        endsAt: ends,
        createdById: input.createdById ?? null,
      },
    });
  }

  async cancelMaintenance(id: string) {
    const row = await this.admin.maintenanceWindow.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Bakım penceresi bulunamadı');
    return this.admin.maintenanceWindow.update({
      where: { id },
      data: { cancelledAt: new Date() },
    });
  }

  async listAnnouncements() {
    return this.admin.platformAnnouncement.findMany({ orderBy: { publishAt: 'desc' }, take: 100 });
  }

  async createAnnouncement(input: {
    title: string;
    body: string;
    severity: string;
    scope: string;
    targetTenantIds?: string[];
    publishAt: string;
    expiresAt: string;
    createdById?: string;
  }) {
    const pub = new Date(input.publishAt);
    const exp = new Date(input.expiresAt);
    if (Number.isNaN(pub.getTime()) || Number.isNaN(exp.getTime()) || pub >= exp) {
      throw new BadRequestException('Geçersiz duyuru yayın/bitiş aralığı');
    }
    return this.admin.platformAnnouncement.create({
      data: {
        title: input.title,
        body: input.body,
        severity: input.severity === 'warning' ? 'warning' : 'info',
        scope: input.scope,
        targetTenantIds: input.scope === 'tenant' ? (input.targetTenantIds ?? []) : [],
        publishAt: pub,
        expiresAt: exp,
        createdById: input.createdById ?? null,
      },
    });
  }

  async archiveAnnouncement(id: string) {
    const row = await this.admin.platformAnnouncement.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Duyuru bulunamadı');
    return this.admin.platformAnnouncement.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
