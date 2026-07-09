// B1 PR 3 — Auto post-op control schedule by surgery type.
//
// Plan: cerrahi tamamlandığında (`markCompleted`) cerrahi tipine göre
// default kontrol takvimi otomatik üretilir. Klinik UI cerraha preview
// gösterir; cerrah override edebilir.
//
// Default'lar (plan'dan):
// - CATARACT: 1, 7, 30, 90 gün
// - RETINA: 1, 7, 14, 30, 90 gün
// - GLAUCOMA: 1, 7, 30, 180 gün
// - STRABISMUS: 7, 30, 90 gün
// - Default (eşleşmeyen): 7, 30, 90 gün

const POST_OP_DEFAULTS: Record<string, number[]> = {
  cataract: [1, 7, 30, 90],
  retina: [1, 7, 14, 30, 90],
  glaucoma: [1, 7, 30, 180],
  strabismus: [7, 30, 90],
};

/** Default 30dk slot, sabah 10. */
const DEFAULT_SLOT_HOUR = 10;
const DEFAULT_SLOT_MINUTES = 30;

export interface PostOpProposal {
  daysFromSurgery: number;
  startsAt: string;
  endsAt: string;
  notes: string;
}

/**
 * Surgery type'ı whitelist'e map ederek default offset günlerini döndürür.
 * Match: case-insensitive, ilk kelime alınır (örn. "Cataract / Phaco" → "cataract").
 */
export function getDefaultOffsetDays(surgeryType: string): number[] {
  const key = surgeryType
    .toLowerCase()
    .trim()
    .split(/\s+|\//)[0];
  return POST_OP_DEFAULTS[key] ?? [7, 30, 90];
}

/**
 * `performedAt` üzerinden offset günlere göre 30 dakikalık post-op slot'ları
 * üretir. `notes` cerrahi tipi + offset bilgisi içerir.
 */
export function buildPostOpProposalsByType(
  surgeryType: string,
  performedAt: Date,
  slotHour = DEFAULT_SLOT_HOUR,
): PostOpProposal[] {
  const offsetDays = getDefaultOffsetDays(surgeryType);
  return offsetDays.map((days) => {
    const start = new Date(performedAt);
    start.setDate(start.getDate() + days);
    start.setHours(slotHour, 0, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + DEFAULT_SLOT_MINUTES);
    return {
      daysFromSurgery: days,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      notes: `Post-op ${days}.gün kontrol (${surgeryType})`,
    };
  });
}
