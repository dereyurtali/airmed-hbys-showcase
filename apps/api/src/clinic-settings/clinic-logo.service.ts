import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { hasPermission } from '@airmed/contracts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
]);

const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.webp', '.svg'] as const;

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

interface UploadInput {
  buffer: Buffer;
  mimeType: string;
}

@Injectable()
export class ClinicLogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async upload(
    input: UploadInput,
    actor: { roles: string[]; effectivePerms?: string[] },
  ): Promise<{ logoUrl: string }> {
    // #665 — effectivePerms (mod-daraltılmış) geçilir; kilitli modda (olcum kiosk)
    // yönetici bile logo değiştiremez (mode-blind raw-rol kontrolü kapatıldı).
    if (!hasPermission(actor.roles, 'action:clinicSettings.update', actor.effectivePerms)) {
      throw new ForbiddenException('Logo yükleme yetkiniz yok');
    }
    this.validate(input);

    const tenantId = this.tenantContext.requireTenantId();
    await this.removeStorageFiles(tenantId);

    const ext = MIME_TO_EXT[input.mimeType.toLowerCase()] ?? '.png';
    const key = this.buildKey(tenantId, ext);
    await this.storage.saveBuffer(key, input.buffer);

    const logoUrl = this.buildPublicUrl(tenantId);
    const result = await this.prisma.tenant.updateMany({
      where: { id: tenantId, deletedAt: null, status: 'active' },
      data: { logoUrl },
    });
    if (result.count === 0) throw new NotFoundException('Tenant bulunamadı veya pasif');
    return { logoUrl };
  }

  // Public stream — tenantId query param ile resolve. Logo non-sensitive
  // (subdomain'de zaten açık) ve `<img src>` ile çekildiği için auth header
  // geçemez; public endpoint + tenant scoping ile cross-tenant rastgele
  // tahmine kapalı (UUID).
  async getStreamPublic(tenantId: string | undefined): Promise<StreamableFile> {
    if (!tenantId || !UUID_PATTERN.test(tenantId)) {
      throw new NotFoundException('Klinik logosu bulunamadı');
    }
    return this.streamFor(tenantId);
  }

  async remove(actor: { roles: string[]; effectivePerms?: string[] }): Promise<void> {
    if (!hasPermission(actor.roles, 'action:clinicSettings.update', actor.effectivePerms)) {
      throw new ForbiddenException('Logo silme yetkiniz yok');
    }
    const tenantId = this.tenantContext.requireTenantId();
    await this.removeStorageFiles(tenantId);
    await this.prisma.tenant.updateMany({
      where: { id: tenantId, deletedAt: null, status: 'active' },
      data: { logoUrl: null },
    });
  }

  // Setup akışında kullanılır: authenticated context yok, tenantId parametre
  // olarak verilir. Idempotent — overwrite-safe (sabit "logo" key adı).
  async writeForTenant(tenantId: string, input: UploadInput): Promise<{ logoUrl: string }> {
    this.validate(input);
    await this.removeStorageFiles(tenantId);
    const ext = MIME_TO_EXT[input.mimeType.toLowerCase()] ?? '.png';
    const key = this.buildKey(tenantId, ext);
    await this.storage.saveBuffer(key, input.buffer);
    return { logoUrl: this.buildPublicUrl(tenantId) };
  }

  private async streamFor(tenantId: string): Promise<StreamableFile> {
    for (const ext of ALLOWED_EXTENSIONS) {
      const candidate = this.buildKey(tenantId, ext);
      if (await this.storage.exists(candidate)) {
        return new StreamableFile(this.storage.readStream(candidate), {
          type: EXT_TO_MIME[ext],
        });
      }
    }
    throw new NotFoundException('Klinik logosu bulunamadı');
  }

  private buildPublicUrl(tenantId: string): string {
    return `/api/clinic-settings/logo/file?tenantId=${tenantId}&v=${Date.now()}`;
  }

  private validate(input: UploadInput): void {
    if (input.buffer.byteLength === 0) {
      throw new BadRequestException('Dosya boş');
    }
    if (input.buffer.byteLength > MAX_LOGO_BYTES) {
      throw new BadRequestException('Logo 2 MB sınırını aşıyor');
    }
    const mime = input.mimeType.toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      throw new BadRequestException(`Desteklenmeyen format: ${input.mimeType}`);
    }
  }

  private buildKey(tenantId: string, ext: string): string {
    return path.posix.join(tenantId, 'clinic', `logo${ext}`);
  }

  private async removeStorageFiles(tenantId: string): Promise<void> {
    for (const ext of ALLOWED_EXTENSIONS) {
      await this.storage.remove(this.buildKey(tenantId, ext));
    }
  }
}
