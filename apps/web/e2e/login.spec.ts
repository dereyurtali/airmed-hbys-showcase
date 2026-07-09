import { test, expect } from '@playwright/test';
import { E2E_ADMIN } from './helpers';

test.describe('login flow', () => {
  // Golden path admin (yonetici_asistani) ile: /dashboard'a düşer + dashboard-root.
  // (Sadece-doktor /worklist'e düşer; golden-path için /dashboard landing'i olan
  // admin kullanılır.)
  test('golden path: login → dashboard, logout → login', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByTestId('login-form')).toBeVisible();
    await expect(page.getByTestId('login-tenant')).toHaveValue('demoeye-dushanbe');

    await page.getByTestId('login-email').fill(E2E_ADMIN.email);
    await page.getByTestId('login-password').fill(E2E_ADMIN.password);
    await page.getByTestId('login-submit').click();

    await page.waitForURL('**/dashboard');
    await expect(page.getByTestId('dashboard-root')).toBeVisible();

    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('logout-btn').click();

    await page.waitForURL('**/login');
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('wrong password keeps user on /login and surfaces error', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(E2E_ADMIN.email);
    await page.getByTestId('login-password').fill('definitely-wrong-password');
    await page.getByTestId('login-submit').click();

    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('empty submit triggers client-side validation, no network call', async ({ page }) => {
    await page.goto('/login');

    let loginRequestFired = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/trpc/auth.login')) loginRequestFired = true;
    });

    await page.getByTestId('login-submit').click();
    // Zod resolver should reject before mutation runs.
    await expect(page).toHaveURL(/\/login$/);
    expect(loginRequestFired).toBe(false);
  });
});
