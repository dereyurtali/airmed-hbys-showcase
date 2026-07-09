import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

// #948 (Feature 4) — CIDR ekleme DTO. Basit IPv4 CIDR şekli (regex); servis
// ayrıca Ipv4Cidr ile octet/prefix doğrular (geçersizse 400).
export class AddCidrDto {
  @Matches(/^(\d{1,3}\.){3}\d{1,3}(\/([0-9]|[12][0-9]|3[0-2]))?$/, {
    message: 'cidr must be a valid IPv4 CIDR (e.g. 203.0.113.0/24)',
  })
  cidr!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}

export class CidrIdParamDto {
  @IsUUID()
  id!: string;
}
