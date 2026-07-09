import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type PlatformRole } from '@airmed/db';
import { Ipv4Cidr } from '../../common/cidr.util';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { AddCidrDto } from './ip-allowlist.dto';

// #948 (Feature 4) — Platform admin IP allowlist yönetimi. list okuma tüm
// rollere; add/remove yalnız platform_owner. remove'da self-lockout koruması:
// silme sonrası actor'ın mevcut IP'si kalan aktif kurallardan biriyle
// eşleşmiyorsa 409 (kendini kilitleme). Guard cache 30sn (etki gecikmesi).

interface Actor {
  id: string;
  email: string;
  role: PlatformRole;
}
interface Ctx {
  ip: string | null;
  userAgent: string | null;
}

// Guard'daki normaliseIp ile aynı (::ffff:/::1 → IPv4); util export etmiyor.
function normaliseIp(ip: string): string {
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

@Injectable()
export class IpAllowlistService {
  // #1065 — paylaşımlı AdminPrismaService (tek havuz).
  constructor(
    private readonly audit: PlatformAuditService,
    private readonly admin: AdminPrismaService,
  ) {}

  private assertReader(a: Actor): void {
    if (
      a.role === 'platform_owner' ||
      a.role === 'platform_engineer' ||
      a.role === 'platform_support'
    )
      return;
    throw new ForbiddenException('Platform admin gerekiyor');
  }

  private assertOwner(a: Actor): void {
    if (a.role !== 'platform_owner')
      throw new ForbiddenException('Bu işlem yalnız platform_owner için');
  }

  async list(actor: Actor) {
    this.assertReader(actor);
    return this.admin.platformAdminIpAllowlist.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async add(dto: AddCidrDto, actor: Actor, ctx: Ctx) {
    this.assertOwner(actor);
    try {
      new Ipv4Cidr(dto.cidr);
    } catch {
      throw new BadRequestException('Geçersiz CIDR');
    }
    const created = await this.admin.platformAdminIpAllowlist.create({
      data: { cidr: dto.cidr, label: dto.label ?? null },
    });
    await this.audit.record({
      action: 'ip_allowlist.add',
      adminId: actor.id,
      email: actor.email,
      entityType: 'ip_allowlist',
      entityId: created.id,
      payload: { cidr: dto.cidr },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return created;
  }

  async remove(id: string, actor: Actor, ctx: Ctx) {
    this.assertOwner(actor);
    const target = await this.admin.platformAdminIpAllowlist.findUnique({ where: { id } });
    if (!target || !target.isActive) throw new NotFoundException('Kural bulunamadı');

    // Self-lockout koruması: silmeden sonra actor'ın IP'si kalan aktif kurallarla
    // eşleşmeli. Guard'da bypass (DEV_PLATFORM_OPEN_IPS) olsa da kontrol her zaman
    // koşar (kilitlenmeyi önlemek defense-in-depth; kasıtlıysa önce kapsayan kural
    // eklenir).
    const active = await this.admin.platformAdminIpAllowlist.findMany({
      where: { isActive: true },
    });
    const remaining = active.filter((r) => r.id !== id);
    const actorIp = normaliseIp(ctx.ip ?? '');
    const stillAllowed = remaining.some((r) => {
      try {
        return new Ipv4Cidr(r.cidr).contains(actorIp);
      } catch {
        return false;
      }
    });
    if (!stillAllowed) {
      throw new ConflictException('Bu kuralı silersen kendini kilitlersin');
    }

    await this.admin.platformAdminIpAllowlist.delete({ where: { id } });
    await this.audit.record({
      action: 'ip_allowlist.remove',
      adminId: actor.id,
      email: actor.email,
      entityType: 'ip_allowlist',
      entityId: id,
      payload: { cidr: target.cidr },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true };
  }
}
