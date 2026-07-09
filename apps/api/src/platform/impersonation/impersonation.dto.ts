import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class StartImpersonationDto {
  // `loose` = herhangi bir hex-formatlı UUID kabul; test fixture'larında v4
  // olmayan ID'ler var (`1111-aaaa-...`). Üretimde Prisma `uuid()` v4 üretiyor.
  @IsUUID('loose', { message: 'targetUserId UUID olmalı' })
  targetUserId!: string;

  @IsString()
  @MinLength(10, { message: 'reason en az 10 karakter' })
  reason!: string;

  // Default 15 dk, max 60 dk — F4 plan kuralı. Min 1, integer.
  @IsInt()
  @Min(1)
  @Max(60)
  durationMin: number = 15;
}

export class ImpersonationIdParamDto {
  @IsUUID('loose')
  id!: string;
}

// #950 (Feature 2) — biten impersonation oturumları geçmişi filtreleri.
export class ImpersonationHistoryQueryDto {
  @IsOptional()
  @IsUUID('loose')
  tenantId?: string;

  @IsOptional()
  @IsUUID('loose')
  adminId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
