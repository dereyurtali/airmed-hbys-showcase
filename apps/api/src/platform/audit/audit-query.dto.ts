import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// #945 (F3, EPIC #956) — platform audit READ query filtreleri (class-validator).
// Global ValidationPipe transform:true → `take` string→number dönüşür.
export class ListAuditQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @IsOptional()
  @IsUUID()
  adminId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  // Cursor = son görülen kaydın id'si (createdAt desc sıralı sayfa).
  @IsOptional()
  @IsUUID()
  cursor?: string;

  // Unbounded findMany yasak (Ortak DoD) — default 50, max 200.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}
