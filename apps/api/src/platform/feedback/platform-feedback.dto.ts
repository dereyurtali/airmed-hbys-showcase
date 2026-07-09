import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

// Platform (DNA) cross-tenant geri-bildirim gelen kutusu filtreleri.
export class PlatformFeedbackListQueryDto {
  @IsOptional()
  @IsIn(['submitted', 'in_progress', 'shipped', 'rejected'])
  status?: string;

  @IsOptional()
  @IsIn(['bug', 'improvement', 'question'])
  kind?: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

// #951 — Triyaj: status + GitHub issue no + shipped version güncelleme.
export class UpdateFeedbackDto {
  @IsIn(['submitted', 'in_progress', 'shipped', 'rejected'])
  status!: string;

  // number → set; null → temizle; undefined → dokunma. null'da IsInt atlanır.
  @IsOptional()
  @ValidateIf((o: UpdateFeedbackDto) => o.githubIssueNo !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9_999_999)
  githubIssueNo?: number | null;

  @IsOptional()
  @ValidateIf((o: UpdateFeedbackDto) => o.shippedVersion !== null)
  @IsString()
  @MaxLength(40)
  shippedVersion?: string | null;
}

export class FeedbackIdParamDto {
  @IsUUID()
  id!: string;
}
