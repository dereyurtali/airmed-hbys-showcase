import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const TIMEZONES = [
  'Asia/Dushanbe',
  'Asia/Tashkent',
  'Asia/Bishkek',
  'Asia/Almaty',
  'Europe/Istanbul',
  'Europe/Moscow',
  'UTC',
] as const;

export class BootstrapSetupDto {
  @IsString()
  @Matches(/^[a-z0-9-]{3,40}$/, {
    message: 'slug 3-40 karakter, küçük harf/rakam/tire içermeli',
  })
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  clinicName!: string;

  @IsString()
  @Matches(/^[A-Z]{2,3}$/, { message: 'MRN ön eki 2-3 BÜYÜK harf olmalı' })
  mrnPrefix!: string;

  @IsIn(['tr', 'ru', 'tg'])
  locale!: 'tr' | 'ru' | 'tg';

  @IsIn(TIMEZONES)
  timezone!: (typeof TIMEZONES)[number];

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  adminName!: string;

  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin' })
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  adminEmail!: string;

  @IsString()
  @MinLength(12, { message: 'Şifre en az 12 karakter olmalı' })
  @MaxLength(200)
  adminPassword!: string;
}

export const SUPPORTED_TIMEZONES = TIMEZONES;
