import type { Role } from '@airmed/contracts';
import { ROLES } from '@airmed/contracts';

// S14 — v0.1 indirim onayı port. Rol başına self-approve cap'i (yüzde, 0..100).
// Bu cap'i aşan indirim → DiscountApproval oluşur, Invoice 'pending_approval'.
// Cap'in altı → indirim doğrudan geçer.
//
// Kaynak: docs/audits/2026-04-08 ... discount-rules.ts (v0.1)
// v0.1'de 3 katmandı: defaultAuthority + approvalChain + globalCaps. v0.2 port
// tek katman + ServiceItem.maxDiscountSelf override (ileri faz). Pilot'tan
// gelen "müşteri görüşmesi" benzeri kararlardan sonra tenant başına override
// imkânı eklenecek (şu an: tüm tenantlar aynı default).
//
// Değerler v0.1 tasarım dökümanından + müşteri görüşmesi (2026-05-28) sonrası
// sözleşme satırlarından türetildi:
//   - resepsiyon: küçük indirim (sosyal davranış, taksit uzlaşması)
//   - ameliyat_satis: paket satış pazarlığı için biraz daha yüksek
//   - doktor: tıbbi sebepten ücretsiz hizmet için
//   - hemsire: indirim vermez (operasyon dışı)
//   - olcum_hemsiresi: indirim vermez (ölçüm istasyonu, mali işlem yok)
//   - yonetici: tam yetki (cap yok)
//   - yonetici_asistani: v0.4.2 Karar 10 (#727) "operate-but-not-finalize" → self %10
//     (>%10 yöneticiye/finansa onaya düşer), approvable=0 (indirim taleplerini ONAYLAYAMAZ;
//     yalnız listeler + eskale eder). Önceki {self:50, approvable:100}.

export const ROLE_DISCOUNT_LIMITS: Record<Role, { self: number; approvable: number }> = {
  [ROLES.YONETICI]: { self: 100, approvable: 100 },
  [ROLES.YONETICI_ASISTANI]: { self: 10, approvable: 0 },
  [ROLES.DOKTOR]: { self: 15, approvable: 0 },
  [ROLES.RESEPSIYON]: { self: 5, approvable: 0 },
  [ROLES.AMELIYAT_SATIS]: { self: 10, approvable: 0 },
  [ROLES.HEMSIRE]: { self: 0, approvable: 0 },
  [ROLES.OLCUM_HEMSIRESI]: { self: 0, approvable: 0 },
  // v0.4 İP-9 (#545) — Finans Yetkilisi: indirim/iade onay otoritesi (yönetici ile
  // eş). approvable=100 → indirim taleplerini onaylar (canApproveDiscount). Mutlak
  // tavan (DEFAULT_MAX_APPROVABLE_DISCOUNT / tenant maxApprovableDiscountPercent)
  // finans dahil herkese uygulanır. Stok&SatınAlma + Eczane indirim vermez.
  [ROLES.FINANS]: { self: 100, approvable: 100 },
  [ROLES.STOK_SATINALMA]: { self: 0, approvable: 0 },
  [ROLES.ECZANE]: { self: 0, approvable: 0 },
};

// Kullanıcının rolleri arasındaki maksimum self-cap döner. Çoklu rol senaryosu
// (örn. yonetici_asistani + doktor) için "en az kısıtlı" rol kazanır.
export function maxSelfLimitFor(roles: readonly string[]): number {
  let best = 0;
  for (const role of roles) {
    const limit = ROLE_DISCOUNT_LIMITS[role as Role];
    if (limit && limit.self > best) best = limit.self;
  }
  return best;
}

// Onay verme yetkisi: approvable > 0 olan herhangi bir rol yeterli.
// Şu an sadece yonetici (100%) ve finans (100%). yonetici_asistani v0.4.2 Karar 10
// ile approvable=0'a indirildi → onaylayamaz (yalnız incele + eskale).
export function canApproveDiscount(roles: readonly string[]): boolean {
  return roles.some((role) => {
    const limit = ROLE_DISCOUNT_LIMITS[role as Role];
    return Boolean(limit && limit.approvable > 0);
  });
}

// #361 — Mutlak indirim tavanı. Rol self-cap'i "onay GEREKİR mi" sorusunu
// yanıtlar; bu tavan ise "onayla bile uygulanabilir mi" sorusunu yanıtlar.
// Konsültasyon kararı (>%30 sistem blok) bu eşikte kodlanır: yönetici dahil
// hiçbir rol bu oranın üstünde indirim ONAYLAYAMAZ. Tenant başına
// `settings.maxApprovableDiscountPercent` ile değiştirilebilir (0..100); ör.
// hayır/charity vakaları için klinik 100'e çekebilir.
export const DEFAULT_MAX_APPROVABLE_DISCOUNT = 30;

// Tenant.settings JSON'undan mutlak tavanı okur. Eksik/geçersiz/aralık-dışı
// değer → güvenli default. Saf fonksiyon: DB erişimi yok, test edilebilir.
export function readMaxApprovableDiscount(settings: unknown): number {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const value = (settings as Record<string, unknown>).maxApprovableDiscountPercent;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) {
      return value;
    }
  }
  return DEFAULT_MAX_APPROVABLE_DISCOUNT;
}
