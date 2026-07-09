// #947 (Feature 1) — GET /platform/audit yanıt tipleri (F3 backend #945).
export interface PlatformAuditLog {
  id: string;
  adminId: string | null;
  email: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  payload: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditListResponse {
  items: PlatformAuditLog[];
  nextCursor: string | null;
}
