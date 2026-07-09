import { IsEmail, IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { PlatformRole } from '@airmed/db';

// #946 (Feature 3) — Platform admin CRUD DTO'ları (class-validator).
const PLATFORM_ROLES: PlatformRole[] = ['platform_owner', 'platform_engineer', 'platform_support'];

export class CreateAdminDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsIn(PLATFORM_ROLES)
  role!: PlatformRole;
}

export class UpdateAdminRoleDto {
  @IsIn(PLATFORM_ROLES)
  role!: PlatformRole;
}

export class AdminIdParamDto {
  @IsUUID()
  id!: string;
}
