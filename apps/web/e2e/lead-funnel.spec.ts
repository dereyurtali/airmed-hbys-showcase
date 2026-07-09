import { test, expect } from '@playwright/test';
import { loginAdmin } from './helpers';

// Hasta kaynağı (lead funnel) sayfası: yönetici asistanı açar (page:leads),
// başlık + funnel chart container'ı yüklenir.
test.describe('lead funnel page', () => {
  test('admin opens leads page, sees funnel heading', async ({ page }) => {
    await loginAdmin(page);

    await page.getByRole('link', { name: 'Hasta kaynağı', exact: true }).click();
    await expect(page).toHaveURL(/\/leads/);
    await expect(page.getByRole('heading', { name: 'Hasta kaynağı hunisi' })).toBeVisible();
  });
});
