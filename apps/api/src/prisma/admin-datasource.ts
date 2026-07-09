/**
 * Datasource URL for the privileged background / cross-tenant Prisma clients
 * (sync, audit-cleanup, messaging, platform admin services, fraud, auth lookup,
 * setup). These must bypass RLS to see every tenant.
 *
 * #916 — prefer `DATABASE_URL_BG` (the `airmed_bg` role: NOSUPERUSER BYPASSRLS)
 * over the postgres superuser `DATABASE_URL`. A raw-SQL injection in one of
 * these services can then no longer escalate to full-database / superuser
 * control — it stays confined to RLS-bypassing DML. Falls back to
 * `DATABASE_URL` when `DATABASE_URL_BG` is unset (dev / CI convenience, and a
 * safe no-op migration path until ops activates the `airmed_bg` role).
 */
export function adminDatabaseUrl(): string | undefined {
  const base = process.env.DATABASE_URL_BG ?? process.env.DATABASE_URL;
  if (!base) return undefined;
  // #1065 — admin işleri az eşzamanlı; default havuz (cpu*2+1) yerine küçük
  // sabit havuz. Toplam Postgres bağlantı bütçesi max_connections=100 altında
  // bilinçli kalmalı (app havuzu + admin + platform).
  if (base.includes('connection_limit=')) return base;
  const limit = process.env.DB_ADMIN_CONNECTION_LIMIT ?? '5';
  return `${base}${base.includes('?') ? '&' : '?'}connection_limit=${limit}`;
}
