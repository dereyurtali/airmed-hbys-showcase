import { test, expect } from '@playwright/test';
import { loginAdmin } from './helpers';

// A5 doktor izin/tatil — doktor detay sayfasında izin bölümü render dumanı.
// Yönetici asistanı (e2e-admin) ile: tam sidebar + page:doctors erişimi.
// Gerçek izin ekleme/silme + RBAC jest e2e'de
// (apps/api/test/doctor-leave.e2e.spec.ts) kapsamlı test ediliyor.
test.describe('doctor leaves UI', () => {
  test('doctor detail shows leaves section + empty state', async ({ page }) => {
    await loginAdmin(page);

    await page.getByRole('link', { name: 'Doktorlar' }).click();
    await page.getByText('Dr. Test Hekim').first().click();
    await expect(page.getByRole('heading', { name: 'Dr. Test Hekim' })).toBeVisible();

    // Leaves section başlığı
    await expect(page.getByRole('heading', { name: 'İzin / tatil' })).toBeVisible();

    // Boş liste mesajı (seeded leave yok)
    await expect(page.getByText('Aktif veya gelecek izin yok.')).toBeVisible();
  });
});
