// Tek tarih/saat formatlama kaynağı. Klinik kuralı: üç dilde de GG.AA.YYYY
// (2-haneli gün/ay zorunlu → TG'de `9.3.2026` gibi sıfırsız format engellenir).
// Locale'siz `toLocaleString()` çağrıları tarayıcı diline düşüp ABD formatı
// (M/D/YYYY) riski yaratır; bunun yerine her zaman bu util kullanılmalı.

const LOCALE_TO_INTL: Record<string, string> = {
  tr: 'tr-TR',
  ru: 'ru-RU',
  tg: 'tg-TJ',
};

export function localeToIntl(locale: string): string {
  return LOCALE_TO_INTL[locale] ?? 'tr-TR';
}

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

// #1067 — Intl.DateTimeFormat tarayıcının en pahalı constructor'larından;
// render gövdesinde memo'suz kurmak (filtre yazarken her tuşta) boş CPU yükü.
// locale+options anahtarlı süreç-ömürlü cache: options seti sabit ve küçük
// olduğundan büyümez. Yeni formatlama noktaları bunu kullanmalı, ad-hoc
// `new Intl.DateTimeFormat` / render-içi closure kurmamalı.
const dtfCache = new Map<string, Intl.DateTimeFormat>();

export function getDateTimeFormat(
  intlLocale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${intlLocale}|${JSON.stringify(options)}`;
  let fmt = dtfCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(intlLocale, options);
    dtfCache.set(key, fmt);
  }
  return fmt;
}

/** GG.AA.YYYY (örn. 09.03.2026) — üç dilde de aynı. */
export function formatDate(value: string | number | Date, locale: string): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(localeToIntl(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** GG.AA.YYYY SS:dd (24 saat). */
export function formatDateTime(value: string | number | Date, locale: string): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString(localeToIntl(locale), {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formatDate(d, locale)} ${time}`;
}
