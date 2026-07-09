import type { PlatformRole } from '@airmed/db';

export interface PlatformJwtPayload {
  sub: string;
  email: string;
  role: PlatformRole;
}

export interface PlatformAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export type PlatformChallengeStage = 'totp_setup_required' | 'totp_required';

export interface PlatformChallengeJwtPayload {
  sub: string;
  stage: PlatformChallengeStage;
}
