import { test, expect } from '@playwright/test';
import { loginAdmin } from './helpers';

// Prosedürler sayfası: enjeksiyon/lazer/minör prosedür listesi. Yönetici
// asistanı erişir (page:procedures), boş listede boş-durum mesajı görünür.
test.describe('procedure list page', () => {
  test('admin opens prosedürler page, sees table body', async ({ page }) => {
    await loginAdmin(page);

    await page.getByRole('link', { name: 'Prosedürler', exact: true }).click();
    await expect(page).toHaveURL(/\/prosedurler/);
    await expect(page.getByRole('heading', { name: 'Prosedürler' })).toBeVisible();
    // "Tip" filtre combobox'u sayfa hidrasyonunun smoke göstergesi
    await expect(page.getByRole('combobox', { name: 'Tip' })).toBeVisible();
    // Seed'de prosedür yok → boş-durum mesajı görünür
    await expect(page.getByText('Filtreye uyan prosedür bulunamadı.')).toBeVisible();
  });
});
