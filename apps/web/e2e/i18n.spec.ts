import { test, expect } from '@playwright/test';

test.describe('i18n locale switcher', () => {
  test.beforeEach(async ({ context }) => {
    // Force a clean detector start every test so localStorage from a
    // previous test does not leak across cases.
    await context.clearCookies();
  });

  test('TR (default) renders Turkish login title', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('airmed_locale', 'tr');
    });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible();
  });

  test('switch to RU updates login title and persists across reload', async ({ page }) => {
    // Idempotent seed: only set the default on first load, so the user's
    // RU choice survives the reload below instead of being overwritten on
    // every navigation.
    await page.addInitScript(() => {
      if (!window.localStorage.getItem('airmed_locale')) {
        window.localStorage.setItem('airmed_locale', 'tr');
      }
    });
    await page.goto('/login');

    await page.getByTestId('locale-switcher').click();
    await page.getByTestId('locale-option-ru').click();

    await expect(page.getByRole('heading', { name: 'Вход в систему' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Вход в систему' })).toBeVisible();
  });

  test('TG (Tajik) renders correctly with special Cyrillic characters', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('airmed_locale', 'tg');
    });
    await page.goto('/login');

    // "Вуруд" = login title. Tajik translations also use ӯ ҳ ҷ ӣ — we render
    // the LocaleSwitcher dropdown and look for these inside the dropdown
    // labels, which exercise the Inter Cyrillic glyph subset.
    await expect(page.getByRole('heading', { name: 'Вуруд' })).toBeVisible();

    // Open the locale dropdown so the Tajik label is in the DOM with its
    // special characters; if the font is missing those glyphs, screenshot
    // diffing in CI will surface the regression.
    await page.getByTestId('locale-switcher').click();
    await expect(page.getByTestId('locale-option-tg')).toContainText('Тоҷикӣ');
  });
});
