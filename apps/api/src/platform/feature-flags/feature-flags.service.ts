import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { CreateFlagDto, SetOverrideDto, UpdateFlagDto } from './feature-flags.dto';

// F6 Feature Flags servisi (v0.2 dilimi).
//
// In-memory cache:
// - `definitionsCache`: tüm flag definition'ları (10K bytes max, çok küçük)
// - `overridesCache`: tenantId → Map<key, value>
// - TTL: 60 sn. Üst limit değil — write sonrası invalidate edilir.
//
// Yetki (platform): list/read tüm admin, write platform_owner/engineer.
// Yetki (tenant): GET /api/feature-flags — tenant user'ı kendi flag'lerini görür.

interface PlatformActor {
  id: string;
  email: string;
  role: 'platform_owner' | 'platform_engineer' | 'platform_support';
}

interface AuditContext {
  ip?: string | null;
  userAgent?: string | null;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

interface DefinitionRow {
  key: string;
  name: string;
  description: string | null;
  defaultValue: boolean;
  isGlobal: boolean;
}

interface OverrideRow {
  flagKey: string;
  tenantId: string;
  value: boolean;
  setAt: Date;
  setById: string | null;
}

@Injectable()
export class FeatureFlagsService {
  private defsCache: CacheEntry<Map<string, DefinitionRow>> | null = null;
  private overridesByTenant: Map<string, CacheEntry<Map<string, boolean>>> = new Map();

  // #1065 — paylaşımlı AdminPrismaService (tek havuz).
  constructor(
    private readonly audit: PlatformAuditService,
    private readonly admin: AdminPrismaService,
  ) {}

  // -------------------- Public read API --------------------

  // Bir tenant için flag durumu — programatic check için.
  // Bilinmeyen flag → false (güvenli default).
  async isEnabled(key: string, tenantId: string): Promise<boolean> {
    const defs = await this.loadDefinitions();
    const def = defs.get(key);
    if (!def) return false;
    if (def.isGlobal) return def.defaultValue;
    const overrides = await this.loadOverrides(tenantId);
    const override = overrides.get(key);
    return override !== undefined ? override : def.defaultValue;
  }

  // Tenant user için tüm flag listesi — frontend useFeatureFlag hook'u için.
  async listForTenant(tenantId: string): Promise<Record<string, boolean>> {
    const [defs, overrides] = await Promise.all([
      this.loadDefinitions(),
      this.loadOverrides(tenantId),
    ]);
    const out: Record<string, boolean> = {};
    for (const [key, def] of defs.entries()) {
      const override = overrides.get(key);
      out[key] = def.isGlobal ? def.defaultValue : (override ?? def.defaultValue);
    }
    return out;
  }

  // Platform admin görünümü: tüm definitions + her flag için override sayısı.
  async listDefinitionsWithStats(actor: PlatformActor) {
    this.assertReader(actor);
    const defs = await this.admin.featureFlagDefinition.findMany({
      orderBy: { key: 'asc' },
      include: { _count: { select: { overrides: true } } },
    });
    return defs;
  }

  // Belirli bir flag için tüm override'ları döner (admin görünümü).
  async listOverrides(key: string, actor: PlatformActor) {
    this.assertReader(actor);
    const def = await this.admin.featureFlagDefinition.findUnique({ where: { key } });
    if (!def) throw new NotFoundException('Flag tanımı yok');
    return this.admin.featureFlagOverride.findMany({
      where: { flagKey: key },
      orderBy: { setAt: 'desc' },
      include: { flag: { select: { key: true, name: true, defaultValue: true } } },
    });
  }

  // -------------------- Platform write API --------------------

  async createDefinition(input: CreateFlagDto, actor: PlatformActor, ctx: AuditContext) {
    this.assertWriter(actor);
    try {
      const created = await this.admin.featureFlagDefinition.create({
        data: {
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          defaultValue: input.defaultValue ?? false,
          isGlobal: input.isGlobal ?? false,
        },
      });
      this.invalidateDefs();
      await this.audit.record({
        action: 'feature_flag.create',
        adminId: actor.id,
        email: actor.email,
        entityType: 'feature_flag',
        entityId: null,
        payload: { key: created.key, defaultValue: created.defaultValue },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return created;
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === 'P2002') throw new ConflictException('Aynı anahtarla flag zaten var');
      throw err as Error;
    }
  }

  async updateDefinition(
    key: string,
    input: UpdateFlagDto,
    actor: PlatformActor,
    ctx: AuditContext,
  ) {
    this.assertWriter(actor);
    const existing = await this.admin.featureFlagDefinition.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException('Flag tanımı yok');
    const updated = await this.admin.featureFlagDefinition.update({
      where: { key },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.defaultValue !== undefined ? { defaultValue: input.defaultValue } : {}),
        ...(input.isGlobal !== undefined ? { isGlobal: input.isGlobal } : {}),
      },
    });
    this.invalidateAll();
    await this.audit.record({
      action: 'feature_flag.update',
      adminId: actor.id,
      email: actor.email,
      entityType: 'feature_flag',
      entityId: null,
      payload: { key, changes: JSON.parse(JSON.stringify(input)) } as Prisma.InputJsonValue,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return updated;
  }

  async setOverride(
    key: string,
    tenantId: string,
    input: SetOverrideDto,
    actor: PlatformActor,
    ctx: AuditContext,
  ) {
    this.assertWriter(actor);
    const def = await this.admin.featureFlagDefinition.findUnique({ where: { key } });
    if (!def) throw new NotFoundException('Flag tanımı yok');
    if (def.isGlobal) {
      throw new ConflictException('Global flag override edilemez — defaultValue üzerinden ayarla');
    }
    const tenant = await this.admin.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant yok');

    const upserted = await this.admin.featureFlagOverride.upsert({
      where: { flagKey_tenantId: { flagKey: key, tenantId } },
      update: { value: input.value, setById: actor.id, setAt: new Date() },
      create: { flagKey: key, tenantId, value: input.value, setById: actor.id },
    });
    this.invalidateTenant(tenantId);
    await this.audit.record({
      action: 'feature_flag.override.set',
      adminId: actor.id,
      email: actor.email,
      entityType: 'feature_flag',
      entityId: null,
      payload: { key, tenantId, value: input.value },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return upserted;
  }

  async clearOverride(key: string, tenantId: string, actor: PlatformActor, ctx: AuditContext) {
    this.assertWriter(actor);
    const existing = await this.admin.featureFlagOverride.findUnique({
      where: { flagKey_tenantId: { flagKey: key, tenantId } },
    });
    if (!existing) throw new NotFoundException('Override yok');
    await this.admin.featureFlagOverride.delete({
      where: { flagKey_tenantId: { flagKey: key, tenantId } },
    });
    this.invalidateTenant(tenantId);
    await this.audit.record({
      action: 'feature_flag.override.clear',
      adminId: actor.id,
      email: actor.email,
      entityType: 'feature_flag',
      entityId: null,
      payload: { key, tenantId },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true as const };
  }

  // -------------------- Cache helpers --------------------

  private async loadDefinitions(): Promise<Map<string, DefinitionRow>> {
    const now = Date.now();
    if (this.defsCache && this.defsCache.expiresAt > now) return this.defsCache.value;
    const rows = await this.admin.featureFlagDefinition.findMany();
    const map = new Map(
      rows.map((r) => [
        r.key,
        {
          key: r.key,
          name: r.name,
          description: r.description,
          defaultValue: r.defaultValue,
          isGlobal: r.isGlobal,
        },
      ]),
    );
    this.defsCache = { value: map, expiresAt: now + CACHE_TTL_MS };
    return map;
  }

  private async loadOverrides(tenantId: string): Promise<Map<string, boolean>> {
    const now = Date.now();
    const cached = this.overridesByTenant.get(tenantId);
    if (cached && cached.expiresAt > now) return cached.value;
    const rows = await this.admin.featureFlagOverride.findMany({ where: { tenantId } });
    const map = new Map(rows.map((r: OverrideRow) => [r.flagKey, r.value]));
    this.overridesByTenant.set(tenantId, { value: map, expiresAt: now + CACHE_TTL_MS });
    return map;
  }

  invalidateDefs(): void {
    this.defsCache = null;
  }
  invalidateTenant(tenantId: string): void {
    this.overridesByTenant.delete(tenantId);
  }
  invalidateAll(): void {
    this.defsCache = null;
    this.overridesByTenant.clear();
  }

  // -------------------- Yetki --------------------

  private assertReader(actor: PlatformActor): void {
    if (
      actor.role === 'platform_owner' ||
      actor.role === 'platform_engineer' ||
      actor.role === 'platform_support'
    )
      return;
    throw new ForbiddenException('Platform admin gerekiyor');
  }

  private assertWriter(actor: PlatformActor): void {
    if (actor.role === 'platform_owner' || actor.role === 'platform_engineer') return;
    throw new ForbiddenException('Yazma yetkisi yalnız platform_owner/engineer için');
  }
}
