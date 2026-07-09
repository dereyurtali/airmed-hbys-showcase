export type TenantStatus = 'active' | 'trial' | 'suspended' | 'churned';
export type TenantPlan = 'pilot' | 'standard' | 'enterprise';
export type SuspendReason =
  | 'payment_overdue'
  | 'violation'
  | 'customer_request'
  | 'security_incident'
  | 'other';

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  plan: TenantPlan;
  locale: string;
  timezone: string;
  settings: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
  createdAt: string;
  suspendedAt: string | null;
  suspendReason: string | null;
  suspendNote: string | null;
  autoReactivateAt: string | null;
  deletedAt: string | null;
  _count?: { users: number };
}

export interface TenantStats {
  tenant: TenantRow;
  stats: {
    userCount: number;
    patientCount: number;
    recentAppointmentCount: number;
    lastLogin: {
      id: string;
      email: string;
      name: string;
      lastLoginAt: string;
    } | null;
  };
}

export interface CreateTenantResponse {
  tenant: TenantRow;
  adminEmail: string;
  adminTempPassword: string;
}
