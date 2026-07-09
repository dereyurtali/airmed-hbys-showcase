import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// F6 Feature Flags — class-validator DTOs.

export class CreateFlagDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'key must be lower_snake_case (letters, digits, underscore)',
  })
  key!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  defaultValue?: boolean;

  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;
}

export class UpdateFlagDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  defaultValue?: boolean;

  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;
}

export class SetOverrideDto {
  @IsBoolean()
  value!: boolean;
}

export class FlagKeyParamDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(80)
  key!: string;
}

export class FlagTenantParamDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(80)
  key!: string;

  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  tenantId!: string;
}
