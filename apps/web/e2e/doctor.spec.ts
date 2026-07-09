import { test, expect } from '@playwright/test';
import { loginAdmin } from './helpers';

/**
 * Doctor list view sanity check. Yönetici asistanı (e2e-admin) ile login —
 * tam sidebar + page:doctors erişimi var. Seed `Dr. Test Hekim`'i Mon-Fri
 * availability ile ekliyor; satırlar test-tarafı mutasyon olmadan hidrate olur.
 * (Read-only "Yeni doktor gizli" iddiası kaldırıldı: asistan doctor.create
 * yetkili; RBAC jest e2e permission-matrix'te kapsamlı test ediliyor.)
 */
test.describe('doctor module', () => {
  test('logged-in admin sees doctor list and can open detail', async ({ page }) => {
    await loginAdmin(page);

    // Click the sidebar entry rather than goto() — the latter does a hard
    // reload that drops the in-memory access token and bounces back to /login
    // before the refresh-cookie bootstrap completes (race with ProtectedRoute).
    await page.getByRole('link', { name: 'Doktorlar' }).click();

    await expect(page.getByRole('heading', { name: 'Doktorlar' })).toBeVisible();
    await expect(page.getByText('Dr. Test Hekim').first()).toBeVisible();

    // Open detail by clicking the row.
    await page.getByText('Dr. Test Hekim').first().click();
    await expect(page.getByRole('heading', { name: 'Dr. Test Hekim' })).toBeVisible();
    await expect(page.getByText('Haftalık çalışma saatleri')).toBeVisible();
    // Seeded availability shows Pazartesi → Cuma, 5 disjoint windows.
    await expect(page.getByText('Pazartesi')).toBeVisible();
  });
});
