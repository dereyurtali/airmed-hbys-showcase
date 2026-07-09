import { test, expect } from '@playwright/test';
import { loginAdmin } from './helpers';

// Dashboard render dumanı: yönetici asistanı login sonrası /dashboard'a düşer,
// dashboard-root + Bugün özeti + grafik bölümleri (recharts) yüklenir.
// (Sadece-doktor /worklist'e düşüp panosu sadeleştiği için admin kullanılır.)
test.describe('dashboard render', () => {
  test('logged-in admin sees dashboard sections (header, today, charts)', async ({ page }) => {
    await loginAdmin(page);

    // Bugün bölümü ("Bugünün Randevuları" widget'ından ayırmak için exact)
    await expect(page.getByRole('heading', { name: 'Bugün', exact: true })).toBeVisible();
    // Grafik bölümleri — recharts render edildiyse başlıklar görünür
    await expect(page.getByRole('heading', { name: 'Randevu trendi' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Doktor performansı' })).toBeVisible();
  });
});
