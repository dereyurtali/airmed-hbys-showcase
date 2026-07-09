// #419b — Tacikistan Milli Bankası (NBT) resmi kur kaynağı.
// Endpoint (machine-readable XML): https://www.nbt.tj/en/kurs/export_xml.php?date=YYYY-MM-DD
// Format CIS-standardı (CBR-tarzı) — kesin şema sürümle değişebileceği için parser
// TOLERANSLI: hem attribute (code="USD" + <value>) hem element (<CharCode>USD</CharCode>
// + <Value>) stillerini, virgül/nokta ondalığı ve Nominal'i ele alır. Tanınmazsa
// null döner → çağıran son-bilinen kura düşer (offline-safe, fatura bloklanmaz).

const DEFAULT_NBT_URL = 'https://www.nbt.tj/en/kurs/export_xml.php';

export function nbtRatesUrl(date: string): string {
  const base = process.env.NBT_RATES_URL || DEFAULT_NBT_URL;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}date=${date}`;
}

/** XML'den USD→TJS kurunu (1 USD = X TJS) toleranslı çıkar. Bulunamazsa null. */
export function parseNbtUsdRate(xml: string): number | null {
  if (typeof xml !== 'string' || xml.length === 0) return null;
  // Para birimi bloklarına böl (yaygın sarmalayıcı kapanış tag'leri).
  const blocks = xml.split(/<\/(?:Valute|Currency|valute|currency|item|Item|CURRENCY)>/);
  for (const block of blocks) {
    if (!/USD/i.test(block)) continue;
    // USD kodu doğrula: code/charcode attribute/element ya da >USD< metni.
    const isUsd =
      /(?:char)?code\s*=\s*["']\s*USD/i.test(block) ||
      /<(?:char)?code\s*>\s*USD\s*</i.test(block) ||
      />\s*USD\s*</i.test(block);
    if (!isUsd) continue;

    const nominalMatch =
      block.match(/<nominal\s*>\s*(\d+)/i) || block.match(/nominal\s*=\s*["']\s*(\d+)/i);
    const nominal = nominalMatch ? parseInt(nominalMatch[1], 10) || 1 : 1;

    const valueMatch =
      block.match(/<value[^>]*>\s*([\d.,\s]+?)\s*<\/value>/i) ||
      block.match(/value\s*=\s*["']\s*([\d.,]+)\s*["']/i) ||
      block.match(/(\d+[.,]\d+)/);
    if (!valueMatch) continue;

    const value = parseFloat(valueMatch[1].replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) continue;
    return nominal > 0 ? value / nominal : value;
  }
  return null;
}

/** NBT'den güncel USD→TJS kurunu çek. Ağ/parse hatasında null (fallback çağıranda). */
export async function fetchNbtUsdRate(date: string): Promise<number | null> {
  try {
    const res = await fetch(nbtRatesUrl(date), {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/xml, text/xml, */*' },
    });
    if (!res.ok) return null;
    return parseNbtUsdRate(await res.text());
  } catch {
    return null;
  }
}
