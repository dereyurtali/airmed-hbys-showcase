import { ROLES } from '@airmed/contracts';
import {
  canApproveDiscount,
  DEFAULT_MAX_APPROVABLE_DISCOUNT,
  maxSelfLimitFor,
  readMaxApprovableDiscount,
  ROLE_DISCOUNT_LIMITS,
} from './discount-limits';

// S14 — v0.1 indirim cap'leri unit test (DB yok).

describe('ROLE_DISCOUNT_LIMITS', () => {
  it('yonetici: tam yetki (100/100)', () => {
    expect(ROLE_DISCOUNT_LIMITS[ROLES.YONETICI]).toEqual({ self: 100, approvable: 100 });
  });

  it('v0.4.2 Karar 10 — yonetici_asistani: self=10, approvable=0 (operate-but-not-finalize)', () => {
    expect(ROLE_DISCOUNT_LIMITS[ROLES.YONETICI_ASISTANI].self).toBe(10);
    expect(ROLE_DISCOUNT_LIMITS[ROLES.YONETICI_ASISTANI].approvable).toBe(0);
  });

  it('resepsiyon: küçük indirim, onay yok', () => {
    expect(ROLE_DISCOUNT_LIMITS[ROLES.RESEPSIYON].self).toBe(5);
    expect(ROLE_DISCOUNT_LIMITS[ROLES.RESEPSIYON].approvable).toBe(0);
  });

  it('hemsire: hiç indirim', () => {
    expect(ROLE_DISCOUNT_LIMITS[ROLES.HEMSIRE]).toEqual({ self: 0, approvable: 0 });
  });

  it('ameliyat_satis: 10% pazarlık', () => {
    expect(ROLE_DISCOUNT_LIMITS[ROLES.AMELIYAT_SATIS].self).toBe(10);
  });

  it('v0.4 İP-9 — finans: indirim/iade onay otoritesi (100/100)', () => {
    expect(ROLE_DISCOUNT_LIMITS[ROLES.FINANS]).toEqual({ self: 100, approvable: 100 });
  });

  it('v0.4 — stok_satinalma + eczane indirim vermez (0/0)', () => {
    expect(ROLE_DISCOUNT_LIMITS[ROLES.STOK_SATINALMA]).toEqual({ self: 0, approvable: 0 });
    expect(ROLE_DISCOUNT_LIMITS[ROLES.ECZANE]).toEqual({ self: 0, approvable: 0 });
  });
});

describe('maxSelfLimitFor', () => {
  it('tek rol cap döner', () => {
    expect(maxSelfLimitFor([ROLES.DOKTOR])).toBe(15);
    expect(maxSelfLimitFor([ROLES.RESEPSIYON])).toBe(5);
  });

  it('çoklu rol → en yüksek cap', () => {
    expect(maxSelfLimitFor([ROLES.RESEPSIYON, ROLES.YONETICI])).toBe(100);
    expect(maxSelfLimitFor([ROLES.HEMSIRE, ROLES.DOKTOR])).toBe(15);
  });

  it('bilinmeyen rol → 0', () => {
    expect(maxSelfLimitFor(['random_role'])).toBe(0);
  });

  it('boş rol listesi → 0', () => {
    expect(maxSelfLimitFor([])).toBe(0);
  });
});

describe('canApproveDiscount', () => {
  it('yonetici onay verebilir', () => {
    expect(canApproveDiscount([ROLES.YONETICI])).toBe(true);
  });

  it('v0.4.2 Karar 10 — yonetici_asistani onay VEREMEZ (yalnız incele + eskale)', () => {
    expect(canApproveDiscount([ROLES.YONETICI_ASISTANI])).toBe(false);
  });

  it('doktor onay veremez', () => {
    expect(canApproveDiscount([ROLES.DOKTOR])).toBe(false);
  });

  it('resepsiyon onay veremez', () => {
    expect(canApproveDiscount([ROLES.RESEPSIYON])).toBe(false);
  });

  it('ameliyat_satis onay veremez', () => {
    expect(canApproveDiscount([ROLES.AMELIYAT_SATIS])).toBe(false);
  });

  it('v0.4 İP-9 — finans onay verebilir', () => {
    expect(canApproveDiscount([ROLES.FINANS])).toBe(true);
  });

  it('çoklu rol — biri onay verebiliyorsa true', () => {
    expect(canApproveDiscount([ROLES.DOKTOR, ROLES.YONETICI])).toBe(true);
  });
});

describe('readMaxApprovableDiscount', () => {
  it('ayar yoksa default tavanı (%30) döner', () => {
    expect(readMaxApprovableDiscount(null)).toBe(DEFAULT_MAX_APPROVABLE_DISCOUNT);
    expect(readMaxApprovableDiscount({})).toBe(DEFAULT_MAX_APPROVABLE_DISCOUNT);
    expect(readMaxApprovableDiscount(undefined)).toBe(DEFAULT_MAX_APPROVABLE_DISCOUNT);
  });

  it('tenant ayarındaki geçerli değeri okur', () => {
    expect(readMaxApprovableDiscount({ maxApprovableDiscountPercent: 50 })).toBe(50);
    expect(readMaxApprovableDiscount({ maxApprovableDiscountPercent: 0 })).toBe(0);
    expect(readMaxApprovableDiscount({ maxApprovableDiscountPercent: 100 })).toBe(100);
  });

  it('aralık-dışı / geçersiz değerde default döner', () => {
    expect(readMaxApprovableDiscount({ maxApprovableDiscountPercent: -5 })).toBe(
      DEFAULT_MAX_APPROVABLE_DISCOUNT,
    );
    expect(readMaxApprovableDiscount({ maxApprovableDiscountPercent: 101 })).toBe(
      DEFAULT_MAX_APPROVABLE_DISCOUNT,
    );
    expect(readMaxApprovableDiscount({ maxApprovableDiscountPercent: 'x' })).toBe(
      DEFAULT_MAX_APPROVABLE_DISCOUNT,
    );
    expect(readMaxApprovableDiscount({ maxApprovableDiscountPercent: NaN })).toBe(
      DEFAULT_MAX_APPROVABLE_DISCOUNT,
    );
  });

  it('array settings güvenli şekilde default döner', () => {
    expect(readMaxApprovableDiscount([1, 2, 3])).toBe(DEFAULT_MAX_APPROVABLE_DISCOUNT);
  });
});
