import { SetMetadata } from '@nestjs/common';
import type { ApiScope } from '../api-key.schemas';

// Endpoint'in çalışması için ApiKey'in sahip olması GEREKEN scope listesi.
// AND mantığı: liste hepsi bulunmalı (OR değil — endpoint en az şu yetkileri
// ister). Boş liste = sadece geçerli auth yeter (örn. /api/external/me).

export const SCOPES_KEY = 'requireScopes';
export const RequireScopes = (...scopes: ApiScope[]) => SetMetadata(SCOPES_KEY, scopes);
