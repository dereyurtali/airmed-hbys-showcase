import { ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { type PrismaClient, ensureClinicRoles } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { ClinicLogoService } from '../clinic-settings/clinic-logo.service';
import { adminDatabaseUrl } from '../prisma/admin-datasource';
import { AdminPrismaService } from '../prisma/admin-prisma.service';
import { PlatformMaintenanceService } from '../platform/maintenance/platform-maintenance.service';
import type { BootstrapSetupDto } from './dto/bootstrap.dto';

export interface BootstrapLogoFile {
  buffer: Buffer;
  mimeType: string;
}

const BCRYPT_COST = 12;
// pg_advisory_xact_lock için sabit anahtar — çakışmasın diye yüksek bir değer.
const SETUP_LOCK_KEY = 7732001n;

/**
 * SetupService — sıfırdan klinik kurulumu (DB'de hiç user yokken).
 *
 * Neden admin client: PrismaService tenant-scoped RLS bağlantısı
 * (DATABASE_URL_APP) kullanır; oraya `app.current_tenant_id` ayarlanmadan
 * yapılan herhangi bir `users` SELECT'i RLS policy gereği boş döner. Setup
 * akışında henüz tenant context yok ⇒ RLS-bypass query atmamız gerek.
 * #1065 — paylaşımlı AdminPrismaService (tek havuz) inject edilir.
 */
@Injectable()
export class SetupService implements OnModuleInit {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    private readonly clinicLogos: ClinicLogoService,
    private readonly adminPrisma: AdminPrismaService,
    private readonly maintenance: PlatformMaintenanceService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!adminDatabaseUrl()) {
      throw new Error('SetupService: DATABASE_URL env var zorunlu');
    }
    // Eager connect — setup endpoint'i boot'tan hemen sonra çağrılabilir.
    await this.adminPrisma.$connect();
  }

  // Tenant slug + branding'i public döndürür: klinik-primary modelde kutu TEK tenant'lıdır
  // (bir kutu = bir klinik = bir tenant). Login subdomain yerine bunu kullanır — staging
  // (Tailscale hostname'i tenant'la alakasız) ve klinik LAN adresi de doğru çalışsın diye.
  async getStatus(): Promise<{
    needsSetup: boolean;
    tenant: { slug: string; name: string; logoUrl: string | null } | null;
    maintenance: { message: string; endsAt: string } | null;
  }> {
    const count = await this.countUsers(this.adminPrisma);
    if (count === 0) return { needsSetup: true, tenant: null, maintenance: null };
    const tenant = await this.adminPrisma.tenant.findFirst({
      select: { id: true, slug: true, name: true, logoUrl: true },
      orderBy: { slug: 'asc' },
    });
    // #1093 — login ekranı bakım mesajını gösterir (tek-tenant kutuda tenant
    // çözülür → global + tenant penceresi).
    const maintenance = await this.maintenance.activeMaintenance(tenant?.id ?? null);
    return {
      needsSetup: false,
      tenant: tenant ? { slug: tenant.slug, name: tenant.name, logoUrl: tenant.logoUrl } : null,
      maintenance,
    };
  }

  async bootstrap(
    dto: BootstrapSetupDto,
    logoFile?: BootstrapLogoFile,
  ): Promise<{ tenantSlug: string; adminEmail: string }> {
    const passwordHash = await bcrypt.hash(dto.adminPassword, BCRYPT_COST);

    return this.adminPrisma.$transaction(async (tx) => {
      // Race-safe: PostgreSQL Read Committed altında iki paralel transaction
      // aynı anda count=0 görebilir. Advisory lock paralel bootstrap'ları
      // serileştirir; lock transaction sonunda otomatik düşer. SETUP_LOCK_KEY
      // sabit bir BIGINT — başka modülle çakışmaması için seçilmiş özel değer.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`;

      const count = await this.countUsers(tx as unknown as PrismaClient);
      if (count > 0) {
        throw new ConflictException('Sistem zaten kurulmuş; setup yalnızca ilk açılışta çalışır.');
      }

      const tenant = await tx.tenant.create({
        data: {
          slug: dto.slug,
          name: dto.clinicName,
          status: 'active',
          plan: 'pilot',
          locale: dto.locale,
          timezone: dto.timezone,
          mrnPrefix: dto.mrnPrefix,
        },
      });

      // Opsiyonel logo — multipart `logo` field'ı geldiyse storage'a yaz ve
      // tenant.logoUrl'i set et. Validation ClinicLogoService.writeForTenant
      // içinde (boyut + MIME). Hata throw ederse transaction rollback olur,
      // disk dosyası kalsa bile bir sonraki upload onu overwrite eder.
      if (logoFile) {
        const { logoUrl } = await this.clinicLogos.writeForTenant(tenant.id, logoFile);
        await tx.tenant.update({
          where: { id: tenant.id },
          data: { logoUrl },
        });
      }

      // RLS context — bu transaction'da yapılacak role/user/userRole insert'leri
      // için. SET LOCAL transaction sonunda otomatik düşer, leak yok.
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;

      await ensureClinicRoles(tx as unknown as PrismaClient, tenant.id);

      const yoneticiRole = await tx.role.findUniqueOrThrow({
        where: { tenantId_key: { tenantId: tenant.id, key: 'yonetici' } },
      });

      const adminUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.adminEmail,
          passwordHash,
          name: dto.adminName,
          locale: dto.locale,
          status: 'active',
          // Setup ekranında girilen şifreyi kullanıcı kendi yazdığı için
          // mustChangePassword=false. CLI bootstrap aksine: orada şifre
          // üretilip log'a basılıyor → ilk girişte değiştirme zorunlu.
          mustChangePassword: false,
        },
      });

      await tx.userRole.create({
        data: {
          tenantId: tenant.id,
          userId: adminUser.id,
          roleId: yoneticiRole.id,
        },
      });

      this.logger.warn(
        `Setup tamamlandı: tenant=${tenant.slug} admin=${adminUser.email} (${adminUser.id})`,
      );

      return { tenantSlug: tenant.slug, adminEmail: adminUser.email };
    });
  }

  private async countUsers(client: PrismaClient): Promise<number> {
    const rows = await client.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) as count FROM users
    `;
    return Number(rows[0]?.count ?? 0n);
  }
}
