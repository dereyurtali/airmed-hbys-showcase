import { describe, expect, it } from 'vitest';
import { getSidebarVariant, isTopLevelRoute } from './sidebar-variant';
import { ROLES } from '@airmed/contracts';

// v0.4 İP-27 (#563) — rol/mod görünürlüğü omurgası: getSidebarVariant rol+moda
// göre doğru sade/kilitli/markalı sidebar varyantını seçmeli. Mod rolden ÖNCE
// gelir (kiosk izolasyonu); çoklu-rol → tam sidebar.

describe('getSidebarVariant — mod önceliği (rolden önce)', () => {
  it('olcum kilitli mod → measurement-nurse (rol kombinasyonundan bağımsız)', () => {
    expect(getSidebarVariant([ROLES.HEMSIRE], 'olcum')).toBe('measurement-nurse');
    // Kiosk: admin rolü olsa bile kilitli mod kazanır.
    expect(getSidebarVariant([ROLES.YONETICI, ROLES.HEMSIRE], 'olcum')).toBe('measurement-nurse');
  });

  it('genel/asistan modu → nurse', () => {
    expect(getSidebarVariant([ROLES.HEMSIRE], 'genel')).toBe('nurse');
    expect(getSidebarVariant([ROLES.HEMSIRE], 'asistan')).toBe('nurse');
  });
});

describe('getSidebarVariant — tek-rol markalı/sade varyantlar', () => {
  const cases: [string, ReturnType<typeof getSidebarVariant>][] = [
    [ROLES.DOKTOR, 'doctor'],
    [ROLES.RESEPSIYON, 'reception'],
    [ROLES.HEMSIRE, 'nurse'],
    [ROLES.OLCUM_HEMSIRESI, 'measurement-nurse'],
    [ROLES.AMELIYAT_SATIS, 'sales'],
    [ROLES.YONETICI, 'admin'],
    [ROLES.ECZANE, 'pharmacy'],
    [ROLES.FINANS, 'finans'],
    [ROLES.STOK_SATINALMA, 'stok'],
  ];
  for (const [role, variant] of cases) {
    it(`sadece ${role} → ${variant}`, () => {
      expect(getSidebarVariant([role])).toBe(variant);
    });
  }
});

describe('getSidebarVariant — çoklu-rol → tam sidebar', () => {
  it('iki sade rol birleşince full', () => {
    expect(getSidebarVariant([ROLES.DOKTOR, ROLES.RESEPSIYON])).toBe('full');
    expect(getSidebarVariant([ROLES.YONETICI, ROLES.DOKTOR])).toBe('full');
  });

  it('görev ayrılığı: finans + stok aynı kişi → full (her biri diğerinin NON_ listesinde)', () => {
    expect(getSidebarVariant([ROLES.FINANS, ROLES.STOK_SATINALMA])).toBe('full');
  });

  it('rol yok → full (klasik tam sidebar)', () => {
    expect(getSidebarVariant([])).toBe('full');
  });

  // LATENT QUIRK (davranış kaydı): erken-kontrol rolleri (reception/sales/admin...)
  // finans/stok/eczane'den ÖNCE bakılır ve onların NON_*_ROLES listeleri yeni 3 rolü
  // içermez → yeni-rol + erken-rol kombinasyonu erken variantı döndürür ('full' değil).
  // Çoklu-rol ataması UI'da henüz yok (tek rol; rol-modeli kararı), bu yüzden latent.
  // Çoklu-rol UI açılınca NON_*_ROLES'a finans/stok/eczane eklenip 'full'a çevrilmeli.
  it('latent: finans + resepsiyon → reception (erken variant kazanır; çoklu-rol UI kapalı)', () => {
    expect(getSidebarVariant([ROLES.FINANS, ROLES.RESEPSIYON])).toBe('reception');
  });
});

describe('isTopLevelRoute — yeni varyant destinasyonları (BackBar)', () => {
  it('finans: /billing top-level, /billing/:id alt rota', () => {
    expect(isTopLevelRoute('/billing', 'finans')).toBe(true);
    expect(isTopLevelRoute('/billing/inv-1', 'finans')).toBe(false);
  });
  it('stok: /inventory/iol top-level, alt rota değil', () => {
    expect(isTopLevelRoute('/inventory/iol', 'stok')).toBe(true);
    expect(isTopLevelRoute('/patients/abc', 'stok')).toBe(false);
  });
  it('her varyantta /change-password top-level (auth akışı)', () => {
    expect(isTopLevelRoute('/change-password', 'finans')).toBe(true);
    expect(isTopLevelRoute('/change-password', 'stok')).toBe(true);
  });
});
