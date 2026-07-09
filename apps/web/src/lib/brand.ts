// Marka görsel kimliği — tek kaynak (SİS-Y4). Navy → mauve gradient S16
// sürümünün görsel imzasıdır (login + markalı sidebar header). Inline string
// kopyalamak yerine bu sabiti kullan ki palet tek yerden değişsin.
export const BRAND_GRADIENT = 'bg-gradient-to-br from-[#26296b] via-[#34306e] to-[#5a3a56]';

// Dikey sürüm (yukarıdan aşağı) — v0.4.1 rol-menüleri mockup'ında sidebar'ın TÜM
// yüzeyi bu gradient'le kaplanır (sadece header değil). Aynı palet, 180° yön.
export const BRAND_GRADIENT_VERTICAL = 'bg-gradient-to-b from-[#26296b] via-[#34306e] to-[#5a3a56]';

// Markalı header kartının üzerindeki ince diagonal doku (opacity layer'da).
export const BRAND_MESH_BACKGROUND =
  'repeating-linear-gradient(135deg, #fff 0 1px, transparent 1px 11px)';
