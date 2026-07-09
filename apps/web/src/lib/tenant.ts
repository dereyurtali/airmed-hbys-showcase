/**
 * Tenant slug discovery. Production: extract the leftmost subdomain
 * (`demoeye.hbys.dnasoft.co` → `demoeye`). Dev / localhost: fall back
 * to VITE_DEFAULT_TENANT_SLUG, then the seed tenant.
 *
 * The slug is cosmetic on the URL today — backend still validates it on every
 * login — but it lets the LoginPage show the field as read-only and support
 * staff can confirm which clinic a user landed on.
 */
const RESERVED_HOSTS = new Set(['localhost', '127.0.0.1']);
const DEV_FALLBACK = 'demoeye-dushanbe';

export function resolveTenantSlug(hostname: string = window.location.hostname): string {
  const fromEnv = (import.meta.env.VITE_DEFAULT_TENANT_SLUG as string | undefined)?.trim();
  if (RESERVED_HOSTS.has(hostname)) {
    return fromEnv && fromEnv.length > 0 ? fromEnv : DEV_FALLBACK;
  }
  const [first, ...rest] = hostname.split('.');
  // Bare domains (`example.com`, `dnasoft.co`) have no clinic slug;
  // the dev fallback prevents an empty/illegal value reaching the form.
  if (rest.length < 2) {
    return fromEnv && fromEnv.length > 0 ? fromEnv : DEV_FALLBACK;
  }
  return first;
}
