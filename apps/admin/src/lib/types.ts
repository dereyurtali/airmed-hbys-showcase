export type PlatformRole = 'platform_owner' | 'platform_engineer' | 'platform_support';

export interface PlatformAdminPayload {
  id: string;
  email: string;
  role: PlatformRole;
}

export interface LoginChallengeResponse {
  challengeToken: string;
  needsTotpSetup: boolean;
}

export interface SetupTotpResponse {
  otpauthUrl: string;
  secret: string;
  recoveryCodes: string[];
}

export interface VerifyTotpResponse {
  accessToken: string;
}
