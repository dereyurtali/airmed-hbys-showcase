import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// F3 Tenants yönetimi — class-validator DTOs (platform REST endpoint'leri).
//
// Klinik tarafı tRPC/Zod kullanırken platform tarafı REST + class-validator
// kullanıyor (PlatformAuthController ile aynı pattern). v0.3'te tutarlılık için
// tRPC sub-router'a taşınabilir.

const TENANT_STATUSES = ['active', 'trial', 'suspended', 'churned'] as const;
const TENANT_PLANS = ['pilot', 'standard', 'enterprise'] as const;
const SUSPEND_REASONS = [
  'payment_overdue',
  'violation',
  'customer_request',
  'security_incident',
  'other',
] as const;

export class TenantListQueryDto {
  @IsOptional()
  @IsIn([...TENANT_STATUSES])
  status?: (typeof TENANT_STATUSES)[number];

  @IsOptional()
  @IsIn([...TENANT_PLANS])
  plan?: (typeof TENANT_PLANS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsBoolean()
  includeDeleted?: boolean;
}

export class CreateTenantDto {
  // Slug isteğe bağlı — verilmezse name'den üretilir.
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(63)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must be lowercase letters, digits, and hyphens only',
  })
  slug?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsIn([...TENANT_PLANS])
  plan?: (typeof TENANT_PLANS)[number];

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(5)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  // İlk admin (yonetici) kullanıcısı için:
  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  adminName!: string;

  // Verilirse bcrypt ile hashlenir; verilmezse rastgele üretilir ve cevapta
  // bir kez döndürülür (UI'da "kopyaladım" onayı sonrası kaybolur).
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  adminPassword?: string;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsIn([...TENANT_PLANS])
  plan?: (typeof TENANT_PLANS)[number];

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(5)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  featureFlags?: Record<string, unknown>;
}

export class SuspendTenantDto {
  @IsEnum(SUSPEND_REASONS)
  reason!: (typeof SUSPEND_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  // ISO-8601 datetime — verilirse o anda otomatik re-aktive olur.
  @IsOptional()
  @IsString()
  autoReactivateAt?: string;
}

export class TenantIdParamDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  id!: string;
}
