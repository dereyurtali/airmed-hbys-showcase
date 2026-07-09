import { test, expect } from '@playwright/test';
import { loginYonetici } from './helpers';

// S16 v0.3 — Sadece-yönetici ekranları: Genel Bakış (AdminOverviewPage) +
// branded "Yönetim" menüsünden Onay Talepleri + Stok & Malzeme navigasyonu.
test.describe('admin overview (yönetici ekranları)', () => {
  test('genel bakış renders + navigates to onay talepleri + stok takibi', async ({ page }) => {
    await loginYonetici(page); // /dashboard + admin-overview-root

    // Genel Bakış başlığı + KPI etiketleri (veri yokken de label'lar render olur)
    await expect(page.getByRole('heading', { name: 'Genel Bakış' })).toBeVisible();
    await expect(page.getByText('Bugün muayene')).toBeVisible();
    await expect(page.getByText('Onay bekleyen indirim')).toBeVisible();

    // Onay Talepleri → /approvals (İndirim Onay Talepleri)
    await page.getByRole('link', { name: 'Onay Talepleri' }).click();
    await expect(page).toHaveURL(/\/approvals/);
    await expect(page.getByRole('heading', { name: 'İndirim Onay Talepleri' })).toBeVisible();

    // Stok & Malzeme → /inventory/iol (Stok & Malzeme Takibi)
    await page.getByRole('link', { name: 'Stok & Malzeme' }).click();
    await expect(page).toHaveURL(/\/inventory\/iol/);
    await expect(page.getByRole('heading', { name: 'Stok & Malzeme Takibi' })).toBeVisible();
  });
});
