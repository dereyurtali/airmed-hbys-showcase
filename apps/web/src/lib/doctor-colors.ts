// #1018 takvim turu — doktor renk sistemi. Takvim kartında İKİ boyut birden
// okunur: zemin tonu = randevu TÜRÜ (APPOINTMENT_TYPE_META, semantik/sabit),
// sol şerit + baş harf rozeti = DOKTOR (bu palet). Renk tek başına anlam
// taşımaz (a11y): rozet baş harf gösterir, tooltip + filtre menüsü isim yazar.
//
// Atama deterministik: doctorId hash'i → palet indeksi. Aynı doktor her
// oturumda/cihazda aynı rengi alır; DB'de saklamaya gerek yok. Palet, tür
// zeminlerinden (sky/emerald/red/amber/fuchsia aile tonları) ayrışan koyu
// 600'lük kenar tonları kullanır — açık zemin üzerinde 3:1 üstü kontrast.

export interface DoctorColor {
  /** Kart sol şeridi (border-left). */
  border: string;
  /** Nokta/rozet zemini (filtre menüsü + kart baş harf rozeti). */
  dot: string;
}

const PALETTE: DoctorColor[] = [
  { border: 'border-l-blue-600', dot: 'bg-blue-600' },
  { border: 'border-l-violet-600', dot: 'bg-violet-600' },
  { border: 'border-l-teal-600', dot: 'bg-teal-600' },
  { border: 'border-l-orange-600', dot: 'bg-orange-600' },
  { border: 'border-l-rose-600', dot: 'bg-rose-600' },
  { border: 'border-l-indigo-600', dot: 'bg-indigo-600' },
  { border: 'border-l-cyan-700', dot: 'bg-cyan-700' },
  { border: 'border-l-lime-700', dot: 'bg-lime-700' },
  { border: 'border-l-purple-700', dot: 'bg-purple-700' },
  { border: 'border-l-amber-700', dot: 'bg-amber-700' },
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export function doctorColor(doctorId: string): DoctorColor {
  return PALETTE[hashId(doctorId) % PALETTE.length]!;
}

/** "Dr. Methi Akcan" → "MA" (unvan atlanır; sidebar initialsFromName ile aynı kural). */
export function doctorInitials(name: string): string {
  const words = name
    .replace(/\b(Dr|Prof|Op|Uzm|Doç)\.?/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '—';
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
