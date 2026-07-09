import { test, expect } from '@playwright/test';
import { loginAdmin } from './helpers';

// Stok & Malzeme Takibi sayfası dumanı (S16: /inventory/iol → StockTrackingPage).
// Yönetici asistanı açar, sayfa başlığı yüklenir. (Model/lot CRUD ayrı alt-rota
// /inventory/iol/manage'de; bu smoke yalnız takip sayfasının render'ını doğrular.)
test.describe('stock tracking page', () => {
  test('logged-in admin opens stok takibi and sees header', async ({ page }) => {
    await loginAdmin(page);

    await page.getByRole('link', { name: 'IOL stoku', exact: true }).click();
    await expect(page).toHaveURL(/\/inventory\/iol/);
    await expect(page.getByRole('heading', { name: 'Stok & Malzeme Takibi' })).toBeVisible();
  });
});
