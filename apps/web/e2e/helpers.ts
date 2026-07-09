import { expect, type Page } from '@playwright/test';

// Playwright e2e ortak login yardımcıları.
//
// İki seed kullanıcısı (packages/db/prisma/seed.ts):
// - DOCTOR (e2e@demoeye.tj, doktor): kısıtlı menü, login → /worklist landing.
//   RBAC kısıtlama testleri için.
// - ADMIN (e2e-admin@demoeye.tj, yonetici_asistani): tam sidebar + /dashboard
//   landing + jenerik pano. Sayfa-render smoke testleri için (doctors/iol/
//   leads/procedures/schedule/patients).

export const E2E_DOCTOR = {
  email: process.env.E2E_USER_EMAIL ?? 'e2e@demoeye.tj',
  password: process.env.SEED_E2E_PASSWORD ?? 'e2e-test-pass',
};

export const E2E_ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@demoeye.tj',
  password: process.env.SEED_E2E_PASSWORD ?? 'e2e-test-pass',
};

// YONETICI (e2e-yonetici@demoeye.tj, sadece-yönetici): branded AdminSidebar +
// /dashboard → AdminOverviewPage (S16 Genel Bakış). v0.3 yönetici ekranları için.
export const E2E_YONETICI = {
  email: process.env.E2E_YONETICI_EMAIL ?? 'e2e-yonetici@demoeye.tj',
  password: process.env.SEED_E2E_PASSWORD ?? 'e2e-test-pass',
};

/** Login + landing URL'sini bekle (regex veya glob). */
export async function login(
  page: Page,
  creds: { email: string; password: string },
  landing: string | RegExp,
): Promise<void> {
  await page.goto('/login');
  await expect(page.getByTestId('login-form')).toBeVisible();
  await page.getByTestId('login-email').fill(creds.email);
  await page.getByTestId('login-password').fill(creds.password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(landing);
}

/** Admin (asistan) login → /dashboard + dashboard-root görünür. */
export async function loginAdmin(page: Page): Promise<void> {
  await login(page, E2E_ADMIN, '**/dashboard');
  await expect(page.getByTestId('dashboard-root')).toBeVisible();
}

/** Doktor login → /worklist landing (sadece-doktor restricted). */
export async function loginDoctor(page: Page): Promise<void> {
  await login(page, E2E_DOCTOR, '**/worklist');
}

/** Yönetici login → /dashboard + AdminOverviewPage (admin-overview-root). */
export async function loginYonetici(page: Page): Promise<void> {
  await login(page, E2E_YONETICI, '**/dashboard');
  await expect(page.getByTestId('admin-overview-root')).toBeVisible();
}
