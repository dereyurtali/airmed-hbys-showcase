/**
 * Tiny fetch wrapper for the platform API. Always sends `credentials: 'include'`
 * so the airmed_platform_refresh cookie tags along on /refresh + /logout.
 *
 * Locally the Vite dev server proxies /platform/* to the API on :3001 (see
 * apps/admin/vite.config.ts), so a relative URL works in both dev and prod.
 */
const BASE = (import.meta.env.VITE_PLATFORM_API_URL as string | undefined) ?? '';

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  bearer?: string;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// #404 — Global 401 köprüsü. Access token 15 dk sonra ölünce sonraki çağrı 401
// döner; provider bu callback'i kaydedip oturumu temizler → /login redirect.
// Login/refresh/challenge akışlarındaki beklenen 401'ler handler içinde
// (state !== authenticated) filtrelenir, böylece o ekranlar bozulmaz.
type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;

  const qs =
    opts.query &&
    Object.entries(opts.query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
  const url = qs ? `${BASE}${path}?${qs}` : `${BASE}${path}`;

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
    signal: opts.signal,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;

  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.();
    const message =
      (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : null) ?? res.statusText;
    throw new ApiError(res.status, statusCode(res.status), message);
  }

  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function statusCode(status: number): string {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 412) return 'precondition_failed';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'error';
}
