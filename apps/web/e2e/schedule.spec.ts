import { test, expect } from '@playwright/test';
import { loginAdmin } from './helpers';

// Schedule sayfası e2e: read-only flow + randevu CTA deep-link.
// Yönetici asistanı (e2e-admin) ile: /dashboard landing + tam sidebar +
// action:appointment.create yetkisi (CTA + "Yeni randevu" dialog görünür).
test.describe('schedule module', () => {
  test('logged-in user opens schedule page, switches view, toggles legend', async ({ page }) => {
    await loginAdmin(page);

    await page.getByRole('link', { name: 'Randevu takvimi' }).click();
    await expect(page.getByRole('heading', { name: 'Randevu takvimi' })).toBeVisible();

    // Daily default — switcher daily aktif, weekly outline.
    const dailyBtn = page.getByTestId('schedule-view-daily');
    const weeklyBtn = page.getByTestId('schedule-view-weekly');
    await expect(dailyBtn).toBeVisible();
    await expect(weeklyBtn).toBeVisible();

    // Weekly'ye geç → buton state değişir
    await weeklyBtn.click();
    // Daily'e geri dön
    await dailyBtn.click();

    // Type legend toggle: collapsed → expand
    const legendRegion = page.getByRole('region', { name: 'Tip rehberi' });
    await page.getByRole('button', { name: 'Tip rehberi' }).click();
    await expect(legendRegion.getByText('Muayene')).toBeVisible();
    await expect(legendRegion.getByText('Ameliyat')).toBeVisible();
  });

  test('patient detail surfaces "Randevu oluştur" deep-link CTA', async ({ page }) => {
    await loginAdmin(page);

    await page.getByRole('link', { name: 'Hastalar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hastalar' })).toBeVisible();

    // İlk hasta satırına tıkla
    const firstRow = page.locator('tbody tr').first();
    await firstRow.click();
    await page.waitForURL(/\/patients\/[0-9a-f-]+$/);

    // CTA görünür ve doğru URL'e yönlendiriyor olmalı
    const cta = page.getByTestId('patient-new-appointment');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', /\/schedule\?patientId=/);

    // CTA tıkla → schedule'a deep-link
    await cta.click();
    await page.waitForURL(/\/schedule(\?.*)?$/);
    await expect(page.getByRole('heading', { name: 'Yeni randevu' })).toBeVisible();
  });
});
