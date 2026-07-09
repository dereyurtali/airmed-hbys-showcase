import * as crypto from 'node:crypto';

/**
 * Karışıklığı önleyen alfabe: I, l, O, 0, 1 çıkarıldı. Yönetici şifre modal'da
 * kopyalayıp WhatsApp/SMS ile aktarır — yanlış yazma riskini azaltır.
 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGIT = '23456789';
const SYMBOL = '!@#$%^&*';
const ALL = UPPER + LOWER + DIGIT + SYMBOL;

/**
 * 12 karakter güçlü şifre: her sınıftan en az bir karakter garanti
 * (büyük, küçük, rakam, özel). Yöneticinin user yarattığında modal'da
 * gösterilir, bir kere okunur; `mustChangePassword: true` ile kullanıcının
 * ilk login'inde değiştirilir.
 *
 * crypto.randomInt — cryptographically secure (Math.random değil).
 */
export function generateStrongPassword(length = 12): string {
  if (length < 8) {
    throw new Error('generateStrongPassword: minimum 8 karakter');
  }
  const required = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  const rest = Array.from({ length: length - required.length }, () => pick(ALL));
  return shuffle([...required, ...rest]).join('');
}

function pick(charset: string): string {
  return charset[crypto.randomInt(0, charset.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
