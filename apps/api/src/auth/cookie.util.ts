import type { Request, Response } from 'express';

export const REFRESH_COOKIE = 'airmed_refresh';

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/auth',
  };
}

export function setRefreshCookie(res: Response, token: string) {
  const days = parseDays(process.env.JWT_REFRESH_TTL ?? '7d', 7);
  res.cookie(REFRESH_COOKIE, token, {
    ...refreshCookieOptions(),
    maxAge: days * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}

export function readRefreshCookie(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[REFRESH_COOKIE];
}

/**
 * Build a Set-Cookie header value (used by tRPC adapter where we don't have
 * the express Response.cookie helper available).
 */
export function buildSetCookieHeader(token: string): string {
  const days = parseDays(process.env.JWT_REFRESH_TTL ?? '7d', 7);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${REFRESH_COOKIE}=${token}; Max-Age=${days * 24 * 60 * 60}; Path=/api/auth; HttpOnly; SameSite=Lax${secure}`;
}

function parseDays(ttl: string, fallback: number): number {
  const match = /^(\d+)d$/.exec(ttl.trim());
  return match ? Number(match[1]) : fallback;
}
