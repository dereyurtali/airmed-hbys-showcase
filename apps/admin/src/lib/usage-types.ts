// #1088 — Kullanım & büyüme DTO'ları (PlatformUsageService ile birebir).
export interface UsageSummary {
  activeTenants: number;
  activeUsers: number;
  appointments30d: number;
  newPatients30d: number;
}
export interface TenantUsageRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  users: number;
  patients: number;
  appointments30d: number;
  invoices30d: number;
  aiConversations30d: number;
  dbShareRows: number;
  createdAt: string;
}
export interface TrendPoint {
  weekStart: string;
  newPatients: number;
  appointments: number;
}

export type SortKey =
  | 'name'
  | 'users'
  | 'patients'
  | 'appointments30d'
  | 'invoices30d'
  | 'aiConversations30d'
  | 'dbShareRows';

export function sortRows(rows: TenantUsageRow[], key: SortKey, dir: 1 | -1): TenantUsageRow[] {
  return [...rows].sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name) * dir;
    return ((a[key] as number) - (b[key] as number)) * dir;
  });
}
