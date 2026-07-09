import type { Request, Response } from 'express';
import { parseDays } from '../../common/duration.util';

export const PLATFORM_REFRESH_COOKIE = 'airmed_platform_refresh';

/**
 * Platform refresh cookies are scoped to /platform/auth and use SameSite=Strict
 * — the admin SPA only ever calls these endpoints from admin.dnasoft.co
 * so cross-site requests should never carry the cookie.
 */
export function platformRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/platform/auth',
  };
}

export function setPlatformRefreshCookie(res: Response, token: string) {
  const days = parseDays(process.env.PLATFORM_JWT_REFRESH_TTL ?? '7d', 7);
  res.cookie(PLATFORM_REFRESH_COOKIE, token, {
    ...platformRefreshCookieOptions(),
    maxAge: days * 24 * 60 * 60 * 1000,
  });
}

export function clearPlatformRefreshCookie(res: Response) {
  res.clearCookie(PLATFORM_REFRESH_COOKIE, platformRefreshCookieOptions());
}

export function readPlatformRefreshCookie(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[PLATFORM_REFRESH_COOKIE];
}
