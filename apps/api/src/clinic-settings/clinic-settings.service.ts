import { createHash, randomBytes } from 'crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { hasPermission } from '@airmed/contracts';
import { readMaxApprovableDiscount } from '../billing/approval/discount-limits';
import {
  extractWorkingHours,
  type ClinicSettingsUpdateInput,
  type SchedulingSettings,
} from './clinic-settings.schemas';

// S17 — Klinik bilgi (Tenant tablosundaki ad/adres/telefon/logo) yönetimi.
// Yetki: `action:clinicSettings.update` — yalnız yönetici. `get` ise tenant
// kontekstinde her authenticated kullanıcı çağırabilir (klinik adı topbar/
// fatura header'ı gibi yerlerde gerekli). Hassas alan yok.
//
// Madde 1+4 — Tenant.settings JSON içinde `scheduling` anahtarı altında
// randevu planlama ayarları (defaultAppointmentMinutes, postOpFreeMonths)
// tutulur. UI'a response sub-object olarak döner.

const SELECT = {
  id: true,
  slug: true,
  name: true,
  legalName: true,
  address: true,
  phone: true,
  email: true,
  logoUrl: true,
  taxId: true,
  mrnPrefix: true,
  locale: true,
  timezone: true,
  settings: true,
} as const;

function extractScheduling(settings: Prisma.JsonValue | null): SchedulingSettings {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined;
  const s = (settings as { scheduling?: unknown }).scheduling;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return undefined;
  const sc = s as Record<string, unknown>;
  const result: NonNullable<SchedulingSettings> = {};
  if (typeof sc.defaultAppointmentMinutes === 'number') {
    result.defaultAppointmentMinutes = sc.defaultAppointmentMinutes;
  }
  if (typeof sc.postOpFreeMonths === 'number') {
    result.postOpFreeMonths = sc.postOpFreeMonths;
  }
  // #1048 — mesai penceresi (bozuk/eksik JSON = undefined → fallback).
  const workingHours = extractWorkingHours(settings);
  if (workingHours) result.workingHours = workingHours;
  return Object.keys(result).length > 0 ? result : undefined;
}

@Injectable()
export class ClinicSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async get() {
    const tenantId = this.tenantContext.requireTenantId();
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null, status: 'active' },
      select: SELECT,
    });
    if (!tenant) throw new NotFoundException('Tenant bulunamadı');
    const { settings, ...rest } = tenant;
    return {
      ...rest,
      scheduling: extractScheduling(settings),
      // #361 — efektif tavan (ayar yoksa default %30) UI'a döner.
      maxApprovableDiscountPercent: readMaxApprovableDiscount(settings),
    };
  }

  async update(input: ClinicSettingsUpdateInput, actor: { roles: string[] }) {
    if (!hasPermission(actor.roles, 'action:clinicSettings.update')) {
      throw new ForbiddenException('Klinik ayarlarını güncelleme yetkiniz yok');
    }
    const tenantId = this.tenantContext.requireTenantId();
    // Mevcut settings'i oku — scheduling dışı anahtarları korumak için merge
    // ediyoruz (yeni eklenen 'scheduling' yalnız diff edilen alanı yazar).
    const current = await this.prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { settings: true },
    });
    const currentSettings =
      current?.settings && typeof current.settings === 'object' && !Array.isArray(current.settings)
        ? (current.settings as Record<string, unknown>)
        : {};
    const nextSettings: Record<string, unknown> = { ...currentSettings };
    if (input.scheduling !== undefined) {
      const currentScheduling =
        currentSettings.scheduling &&
        typeof currentSettings.scheduling === 'object' &&
        !Array.isArray(currentSettings.scheduling)
          ? (currentSettings.scheduling as Record<string, unknown>)
          : {};
      nextSettings.scheduling = { ...currentScheduling, ...input.scheduling };
    }
    // #361 — Mutlak indirim tavanı. null → anahtarı sil (default %30'a dön).
    if (input.maxApprovableDiscountPercent !== undefined) {
      if (input.maxApprovableDiscountPercent === null) {
        delete nextSettings.maxApprovableDiscountPercent;
      } else {
        nextSettings.maxApprovableDiscountPercent = input.maxApprovableDiscountPercent;
      }
    }
    // tenants tablosu RLS-dışı; defensive where + post-check ile cross-tenant
    // ezme olasılığını sıfırlıyoruz.
    const result = await this.prisma.tenant.updateMany({
      where: { id: tenantId, deletedAt: null, status: 'active' },
      data: {
        name: input.name,
        legalName: input.legalName ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        // logoUrl BURADA YAZILMAZ — logo'nun tek sahibi ClinicLogoService
        // (upload/remove endpoint'leri). Bu form logoUrl göndermediği için
        // buradan `?? null` ile yazmak ayrı yüklenen logoyu siler (data-loss).
        taxId: input.taxId ?? null,
        settings: nextSettings as Prisma.InputJsonValue,
      },
    });
    if (result.count === 0) throw new NotFoundException('Tenant bulunamadı veya pasif');
    return this.get();
  }

  // #1159 — Lobi bekleme ekranı (Raspberry Pi kiosk) yayın anahtarı yönetimi.
  // Yalnız yönetici (action:clinicSettings.update). Anahtar API-key desenidir:
  // düz metin bir kez döner, DB'ye yalnız SHA-256 hash yazılır.
  async getPublicMonitorStatus(): Promise<{ enabled: boolean }> {
    const tenantId = this.tenantContext.requireTenantId();
    const t = await this.prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { publicMonitorKeyHash: true },
    });
    return { enabled: !!t?.publicMonitorKeyHash };
  }

  // Yeni anahtar üretir (varsa döndürür/geçersiz kılar); düz metni SADECE burada
  // döner. Çağıran frontend kiosk URL'ini origin + /public-monitor?key= ile kurar.
  async generatePublicMonitorKey(actor: { roles: string[] }): Promise<{ key: string }> {
    if (!hasPermission(actor.roles, 'action:clinicSettings.update')) {
      throw new ForbiddenException('Bu işlem için yetkiniz yok');
    }
    const tenantId = this.tenantContext.requireTenantId();
    const key = `wm_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(key).digest('hex');
    const result = await this.prisma.tenant.updateMany({
      where: { id: tenantId, deletedAt: null, status: 'active' },
      data: { publicMonitorKeyHash: keyHash },
    });
    if (result.count === 0) throw new NotFoundException('Tenant bulunamadı veya pasif');
    return { key };
  }

  // Yayını kapatır (anahtarı geçersiz kılar). Sonrası endpoint 401 döner.
  async disablePublicMonitorKey(actor: { roles: string[] }): Promise<{ enabled: boolean }> {
    if (!hasPermission(actor.roles, 'action:clinicSettings.update')) {
      throw new ForbiddenException('Bu işlem için yetkiniz yok');
    }
    const tenantId = this.tenantContext.requireTenantId();
    await this.prisma.tenant.updateMany({
      where: { id: tenantId, deletedAt: null, status: 'active' },
      data: { publicMonitorKeyHash: null },
    });
    return { enabled: false };
  }
}
