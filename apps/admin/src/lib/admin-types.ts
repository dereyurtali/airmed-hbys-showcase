import type { PlatformRole } from './types';

// #946 (Feature 3) — GET /platform/admins satır tipi (SAFE_SELECT ile aynı;
// şifre/totpSecret backend'de select'lenmez).
export interface PlatformAdminRow {
  id: string;
  email: string;
  name: string;
  role: PlatformRole;
  isActive: boolean;
  totpVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}
