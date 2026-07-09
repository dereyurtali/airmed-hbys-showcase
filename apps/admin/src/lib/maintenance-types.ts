// #1093 — F6 bakım + duyuru DTO'ları (PlatformMaintenanceService satırları).
export interface MaintenanceWindow {
  id: string;
  scope: string;
  targetTenantId: string | null;
  message: string;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
}
export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  severity: string;
  scope: string;
  publishAt: string;
  expiresAt: string;
  archivedAt: string | null;
}
