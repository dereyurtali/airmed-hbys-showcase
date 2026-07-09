import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Exactly one of `code` (6-digit TOTP) or `recoveryCode` (canonical recovery
 * code) is expected. The service rejects when both / neither are provided.
 */
export class PlatformVerifyTotpDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  recoveryCode?: string;
}
