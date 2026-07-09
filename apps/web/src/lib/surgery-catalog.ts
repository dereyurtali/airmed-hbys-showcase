// #362 — Cerrahi katalog artık DB'de ServiceItem (category='surgery') olarak tutulur;
// fiyat/isim/lens metadata yönetici ekranından düzenlenebilir, 3 dil + tenant-bazlı.
// Eski statik SURGERY_CATALOG kaldırıldı. Bu dosya yalnız:
//   1. Görüntüleme para birimi fallback'i (TJS),
//   2. Surgery.type serbest metnini katalog koduna eşleyen keyword matcher,
//   3. ServiceItem satırından lens/malzeme okuma yardımcıları
// tutar. Satış faturası gerçek serviceItemId ile kesilir → S12c önce-öde sorgusu
// (category='surgery') cerrahi satışı görür.

import type { ServiceItemRow, ServiceItemMetadata } from './billing.trpc';

export const SURGERY_CATALOG_CURRENCY = 'TJS';

// Surgery.type serbest metni (örn. "Phacoemulsification + Trifocal IOL") →
// ServiceItem.code. Eşleşme yoksa null. Anahtar kelimeler önce daha spesifik
// olandan (trifokal/edof) genel katarakta doğru sıralanır.
export function matchSurgeryServiceCode(type: string): string | null {
  const t = type.toLocaleLowerCase('tr');
  if (t.includes('trifocal') || t.includes('trifokal')) return 'OP_CAT_TRI';
  if (t.includes('edof')) return 'OP_CAT_EDOF';
  if (t.includes('pterjium') || t.includes('pterygium')) return 'OP_PTERYGIUM';
  if (t.includes('lasik') || t.includes('excimer') || t.includes('refrakt')) return 'OP_LASIK';
  if (t.includes('trabekül') || t.includes('glokom')) return 'OP_TRABEKULEKTOMI';
  if (t.includes('enjeksiyon') || t.includes('intravitreal') || t.includes('anti-vegf'))
    return 'OP_IVT';
  if (t.includes('prp') || t.includes('argon')) return 'OP_PRP';
  // Katarakt/fako (monofokal dahil) — en genel eşleşme en sona.
  if (
    t.includes('monofocal') ||
    t.includes('monofokal') ||
    t.includes('phaco') ||
    t.includes('fako') ||
    t.includes('katarakt') ||
    t.includes('cataract')
  )
    return 'OP_CAT_MONO';
  return null;
}

// Surgery.type'ı yüklü cerrahi ServiceItem listesindeki satıra eşler.
export function matchSurgeryServiceItem(
  type: string,
  items: ServiceItemRow[],
): ServiceItemRow | null {
  const code = matchSurgeryServiceCode(type);
  if (!code) return null;
  return items.find((i) => i.code === code) ?? null;
}

export function surgeryMeta(item: ServiceItemRow | null | undefined): ServiceItemMetadata {
  return item?.metadata ?? {};
}

// Aktif locale'e göre lokalize isim (RU/TG yoksa TR fallback).
export function localizedServiceName(item: ServiceItemRow, locale: string): string {
  if (locale.startsWith('ru')) return item.nameRu || item.name;
  if (locale.startsWith('tg')) return item.nameTg || item.name;
  return item.name;
}
