import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'tenantSlug must be lowercase alphanumeric with hyphens' })
  @MinLength(2)
  @MaxLength(63)
  tenantSlug!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  // v0.4 (#539) — Girişte seçilen çalışma modu (opsiyonel). Atlanırsa tek/sıfır
  // modlu kullanıcı klasik girer; >1 modlu kullanıcıda yanıt needsModeSelection döner.
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  mode?: string;
}
