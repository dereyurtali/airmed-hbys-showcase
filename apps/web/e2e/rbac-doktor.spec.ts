import { test, expect } from '@playwright/test';
import { loginDoctor } from './helpers';

// RBAC kuralı: doktor rolü sidebar'da Reports/Commission/Fraud linkini görmez,
// /reports, /admin/hakedis, /admin/fraud direkt URL'inden uzaklaştırılır.
// Sadece-doktor login → /worklist landing (kısıtlı menü).
test.describe('rbac — doktor cannot reach yonetici-only pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginDoctor(page);
  });

  test('admin-only sidebar entries (Raporlar/Hakediş/Suistimal) are hidden', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Raporlar', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Hakediş', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Suistimal', exact: true })).toHaveCount(0);
  });

  // Note: doğrudan goto() hard-reload yapıyor, in-memory access token düşüyor;
  // refresh-cookie restore'u ile ProtectedRoute → /login redirect yarışına
  // giriyor. Bu nedenle: kullanıcı /reports veya /admin/fraud URL'inde TUTULMAZ
  // (login veya forbidden'a yönlenir).
  test('direct /reports navigation does not stay on /reports', async ({ page }) => {
    await page.goto('/reports');
    await page.waitForURL((url) => !url.pathname.startsWith('/reports'), { timeout: 10_000 });
    expect(page.url()).not.toContain('/reports');
  });

  test('direct /admin/fraud does not stay on /admin/fraud', async ({ page }) => {
    await page.goto('/admin/fraud');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin/fraud'), { timeout: 10_000 });
    expect(page.url()).not.toContain('/admin/fraud');
  });
});
