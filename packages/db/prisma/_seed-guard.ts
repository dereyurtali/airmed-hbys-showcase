/**
 * Seed scripts are dev/test-only. They create accounts with weak fallback
 * credentials (`admin123`, `platform-owner-dev-pass`, `demo12345`) whenever the
 * matching `SEED_*` env var is unset. If any of them ever run against a
 * production `DATABASE_URL` those accounts land in a live clinic DB — a real
 * account-takeover path that today rests entirely on human discipline
 * ("seed yalnız dev", CLAUDE.md) with no technical barrier.
 *
 * Production go-live never needs a seed: the tenant is created by the F3
 * onboarding wizard and the first platform owner by `platform:admin:bootstrap`.
 * So a hard fail on `NODE_ENV=production` costs nothing legitimate.
 *
 * Escape hatch for the rare deliberate case (e.g. bootstrapping a throwaway
 * prod-like environment): `ALLOW_PRODUCTION_SEED=1`.
 */
export function assertSeedAllowed(label: string): void {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== '1') {
    throw new Error(
      `[${label}] refusing to seed with NODE_ENV=production. Seeds are ` +
        `dev/test-only and write weak fallback credentials. Set ` +
        `ALLOW_PRODUCTION_SEED=1 to override intentionally.`,
    );
  }
}
