// F4 + F7 — apps/admin impersonation tip tanımları.

export interface TenantUserRow {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'suspended' | 'locked' | 'inactive';
  lastLoginAt: string | null;
  roles: string[];
}

export interface ImpersonationStartResponse {
  impersonationId: string;
  impersonationToken: string;
  expiresAt: string;
  targetUser: {
    id: string;
    tenantId: string;
    email: string;
    name: string;
    tenantSlug: string;
    tenantName: string;
    roles: string[];
  };
}

export interface ActiveImpersonationRow {
  id: string;
  platformAdminId: string;
  platformAdminEmail: string;
  platformAdminName: string;
  targetUserId: string;
  targetUserEmail: string;
  targetUserName: string;
  targetTenantId: string;
  targetTenantSlug: string;
  targetTenantName: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  remainingSeconds: number;
}

// #950 (Feature 2) — biten oturum satırı (GET /platform/impersonate/history).
export interface ImpersonationHistoryRow {
  id: string;
  platformAdminEmail: string;
  platformAdminName: string;
  targetUserEmail: string;
  targetUserName: string;
  targetTenantSlug: string;
  targetTenantName: string;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  endedReason: string | null;
  durationSeconds: number;
}
