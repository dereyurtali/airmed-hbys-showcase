import { generateStrongPassword } from './password.util';

describe('generateStrongPassword', () => {
  it('default 12 karakter üretir', () => {
    expect(generateStrongPassword()).toHaveLength(12);
  });

  it('istenen uzunlukta üretir', () => {
    expect(generateStrongPassword(16)).toHaveLength(16);
    expect(generateStrongPassword(8)).toHaveLength(8);
  });

  it('8 karakterden az istenirse hata atar', () => {
    expect(() => generateStrongPassword(7)).toThrow(/minimum 8/);
  });

  it('her sınıftan en az bir karakter içerir (10 örnek)', () => {
    for (let i = 0; i < 10; i++) {
      const pw = generateStrongPassword();
      expect(pw).toMatch(/[A-HJ-NP-Z]/);
      // LOWER alfabesi 'i' içerir (karıştırıcı değil; yalnız l,o çıkarıldı) — regex de
      // 'i'yi kabul etmeli. Önceki /[a-hjkmnp-z]/ 'i'yi dışlıyordu → şifre küçük-harfi
      // yalnız 'i' olunca flake fail (PR #743). Doğru aralık a-k (l hariç) + m,n + p-z.
      expect(pw).toMatch(/[a-kmnp-z]/);
      expect(pw).toMatch(/[2-9]/);
      expect(pw).toMatch(/[!@#$%^&*]/);
    }
  });

  it('karışıklık yaratan karakter (0, 1, I, l, O) içermez', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generateStrongPassword();
      expect(pw).not.toMatch(/[01IlO]/);
    }
  });

  it('iki ardışık çağrı farklı sonuç üretir', () => {
    expect(generateStrongPassword()).not.toBe(generateStrongPassword());
  });
});
