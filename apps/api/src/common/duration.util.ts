/**
 * Parse a "<n>d" duration string (Nd) into a day count. Used for cookie
 * Max-Age and refresh token expiry. Falls back when the input is malformed.
 */
export function parseDays(ttl: string, fallback: number): number {
  const match = /^(\d+)d$/.exec(ttl.trim());
  return match ? Number(match[1]) : fallback;
}
