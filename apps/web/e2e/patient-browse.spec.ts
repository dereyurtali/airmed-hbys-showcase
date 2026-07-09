import { test, expect } from '@playwright/test';
import { loginAdmin } from './helpers';

// Seed hasta: Ayşe Test Hasta (mrn TEST00001)
const SEEDED_PATIENT = { firstName: 'Ayşe', mrn: 'TEST00001' };

// Yönetici asistanı tüm hastaları görür (doktor sıkı izolasyonu yok).
test.describe('patient browse', () => {
  test.beforeEach(async ({ page }) => {
    await loginAdmin(page);
  });

  test('list page renders seeded patient + opens detail', async ({ page }) => {
    await page.getByRole('link', { name: 'Hastalar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hastalar' })).toBeVisible();

    // Seed hastasının satırı listede
    await expect(page.getByText(SEEDED_PATIENT.mrn).first()).toBeVisible();
    await expect(page.getByText(SEEDED_PATIENT.firstName).first()).toBeVisible();

    // Detay sayfası açılır
    await page.getByText(SEEDED_PATIENT.firstName).first().click();
    await page.waitForURL(/\/patients\/[0-9a-f-]+$/);
    // Demografi başlığı veya hasta adı görünür
    await expect(page.getByRole('heading', { level: 1 })).toContainText(SEEDED_PATIENT.firstName);
  });

  test('search filter mrn ile sonuç daraltır', async ({ page }) => {
    await page.getByRole('link', { name: 'Hastalar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hastalar' })).toBeVisible();

    // Search input — placeholder TR locale "Hasta ara..." veya benzeri
    const search = page.locator('input[type="search"], input[placeholder*="ara" i]').first();
    await search.fill(SEEDED_PATIENT.mrn);

    // Debounce sonrası seed hasta görünür kalır
    await expect(page.getByText(SEEDED_PATIENT.mrn).first()).toBeVisible({ timeout: 5000 });
    // Olmayan bir mrn → seed yok
    await search.fill('NONEXISTENT99999');
    await expect(page.getByText(SEEDED_PATIENT.mrn)).toHaveCount(0, { timeout: 5000 });
  });
});
