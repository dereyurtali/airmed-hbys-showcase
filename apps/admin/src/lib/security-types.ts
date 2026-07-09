// #1090 — Güvenlik olayları DTO'ları (PlatformSecurityService ile birebir).
export interface SecuritySummary {
  platformLoginFails24h: number;
  clinicLoginFails24h: number;
  lockedClinicUsers: number;
  activeImpersonations: number;
}
export interface LoginAttemptRow {
  id: string;
  email: string;
  ip: string | null;
  success: boolean;
  failureReason: string | null;
  createdAt: string;
}
export interface LockedUserRow {
  id: string;
  tenantName: string;
  email: string;
  name: string;
  lockedUntil: string;
  failedLoginCount: number;
}
