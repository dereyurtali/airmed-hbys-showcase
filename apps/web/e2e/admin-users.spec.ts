import { test, expect } from '@playwright/test';
import { loginYonetici } from './helpers';

// S17 — Yönetici kullanıcı yönetim ekranı (Ayarlar → Kullanıcılar) smoke.
// Klinik kurulum akışı: yönetici giriş → yeni hemşire ekle → şifre modal'da
// görünür + kopyala → tabloda yeni kullanıcı listelenir → pasifleştir → durum
// "Pasif" badge olarak görünür.
test.describe('admin users — yönetici kullanıcı yönetimi', () => {
  test('yönetici yeni hemşire ekler, şifre gösterilir + pasifleştirir', async ({ page }) => {
    await loginYonetici(page);
    await page.goto('/admin/users');

    await expect(page.getByRole('heading', { name: 'Kullanıcılar' })).toBeVisible();
    await expect(
      page.getByText('Personel hesabı ekleme, rol ataması ve şifre yönetimi.'),
    ).toBeVisible();

    // Tabloda yönetici kendisi görünmeli (admin@demoeye.tj seed). `exact: true`
    // zorunlu — substring match `e2e-admin@demoeye.tj`'yi de yakalıyor (strict
    // mode violation).
    await expect(page.getByRole('cell', { name: 'admin@demoeye.tj', exact: true })).toBeVisible();

    // Yeni kullanıcı: rastgele e-posta (test izolasyonu için timestamp)
    const stamp = Date.now();
    const email = `hemsire-${stamp}@e2e.local`;
    const name = `E2E Hemşire ${stamp}`;

    await page.getByRole('button', { name: 'Yeni Kullanıcı' }).click();

    const createDialog = page.getByRole('dialog');
    await expect(createDialog.getByText('Yeni kullanıcı ekle')).toBeVisible();
    await createDialog.getByLabel('Ad Soyad').fill(name);
    await createDialog.getByLabel('E-posta').fill(email);
    // Rol "hemsire" — Doktor değil, conditional doktor alanları gizli kalır
    await createDialog.getByLabel('Rol').selectOption('hemsire');
    await createDialog.getByRole('button', { name: 'Kullanıcıyı Oluştur' }).click();

    // Create dialog kapanır, password reveal modal'ı açılır
    const passwordModal = page.getByTestId('password-reveal');
    await expect(passwordModal).toBeVisible();
    await expect(passwordModal.getByText(email)).toBeVisible();
    const passwordValue = passwordModal.getByTestId('password-value');
    const passwordText = (await passwordValue.textContent())?.trim() ?? '';
    expect(passwordText).toHaveLength(12);
    // Modal'ı kapat
    await passwordModal.getByRole('button', { name: 'Anladım, kapat' }).click();
    await expect(passwordModal).not.toBeVisible();

    // Tabloda yeni hemşire göründü. `exact: true` ad sütunundaki "E2E Hemşire …"
    // ile rol badge'indeki "Hemşire" arasında strict mode çakışmasını engeller.
    await expect(page.getByRole('cell', { name: email })).toBeVisible();
    const newRow = page.getByRole('row', { name: new RegExp(email) });
    await expect(newRow.getByText('Hemşire', { exact: true })).toBeVisible();
    await expect(newRow.getByText('Aktif', { exact: true })).toBeVisible();

    // Pasifleştir: row action menu → Pasifleştir → onay
    await newRow.getByRole('button', { name: 'İşlemler' }).click();
    await page.getByRole('menuitem', { name: 'Pasifleştir' }).click();
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog.getByText('Kullanıcıyı pasifleştir')).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Pasifleştir' }).click();

    // Durum "Pasif"e döner
    await expect(newRow.getByText('Pasif')).toBeVisible();
  });
});
