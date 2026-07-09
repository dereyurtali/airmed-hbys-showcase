import {
  computeEffectivePermissions,
  hasPermission,
  isLockedMode,
  LOCKED_MODE_PERMISSIONS,
  LOCKED_MODES,
  NURSE_MODES,
  resolveLoginMode,
  ROLES,
  type PermissionOverride,
} from '@airmed/contracts';

describe('hasPermission — 3 modlu kontrol', () => {
  it('effectivePerms verilirse yalnız o sete bakar (override kanonik)', () => {
    // Resepsiyon rolü registry'de page:fraud'a sahip değil; ama effectivePerms
    // bunu içeriyorsa true; registry'e düşmez.
    expect(hasPermission([ROLES.RESEPSIYON], 'page:fraud', ['page:fraud', 'page:dashboard'])).toBe(
      true,
    );

    // Yönetici registry'de page:billing'e sahip; ama effectivePerms bunu
    // dışlıyorsa false (override deny).
    expect(hasPermission([ROLES.YONETICI], 'page:billing', ['page:dashboard'])).toBe(false);
  });

  it('effectivePerms undefined → registry fallback (legacy/test)', () => {
    expect(hasPermission([ROLES.YONETICI], 'page:billing')).toBe(true);
    expect(hasPermission([ROLES.DOKTOR], 'page:billing')).toBe(false);
  });

  it('boş effectivePerms = anlamlı kısıtlama (hiç izin yok)', () => {
    // Boş array undefined değil; öncelik sırası gereği effectivePerms'e bakılır.
    // Eğer kullanıcının tüm izinleri override ile reddedildiyse bu mümkün.
    expect(hasPermission([ROLES.YONETICI], 'page:billing', [])).toBe(false);
  });
});

describe('computeEffectivePermissions — login/refresh bake mantığı', () => {
  it('override yoksa registry varsayılanı geçerli', () => {
    const perms = computeEffectivePermissions([ROLES.RESEPSIYON], []);
    // Resepsiyon registry'de page:billing'e sahip (Wave 319 fix sonrası).
    expect(perms).toContain('page:billing');
    expect(perms).toContain('action:invoice.create');
    // Resepsiyon page:fraud'a sahip değil.
    expect(perms).not.toContain('page:fraud');
  });

  it('allow override registry yokluğunda izin verir', () => {
    const overrides: PermissionOverride[] = [
      { roleKey: ROLES.RESEPSIYON, resource: 'page:fraud', allowed: true },
    ];
    const perms = computeEffectivePermissions([ROLES.RESEPSIYON], overrides);
    expect(perms).toContain('page:fraud');
  });

  it('deny override registry varlığında reddeder', () => {
    const overrides: PermissionOverride[] = [
      { roleKey: ROLES.YONETICI, resource: 'page:billing', allowed: false },
    ];
    const perms = computeEffectivePermissions([ROLES.YONETICI], overrides);
    expect(perms).not.toContain('page:billing');
  });

  it('birden fazla rol → OR semantiği (herhangi biri izin verirse etkili)', () => {
    // Kullanıcı yönetici_asistani + ameliyat_satis; biri page:cashRegister'a
    // sahip, diğeri de — sonuç kesin izinli.
    const perms = computeEffectivePermissions([ROLES.YONETICI_ASISTANI, ROLES.AMELIYAT_SATIS], []);
    expect(perms).toContain('page:cashRegister');
  });

  it('bir rolde allow override + diğer rolde deny → allow kazanır (OR)', () => {
    // Resepsiyon page:fraud allow override + doktor (registry sahip değil)
    // — kullanıcı her iki role sahipse fraud erişimi var.
    const overrides: PermissionOverride[] = [
      { roleKey: ROLES.RESEPSIYON, resource: 'page:fraud', allowed: true },
    ];
    const perms = computeEffectivePermissions([ROLES.RESEPSIYON, ROLES.DOKTOR], overrides);
    expect(perms).toContain('page:fraud');
  });

  it('boş roller → boş izin seti', () => {
    expect(computeEffectivePermissions([], [])).toEqual([]);
  });

  it('aynı rol için resource override + farklı resource registry → ikisi de etkili', () => {
    const overrides: PermissionOverride[] = [
      { roleKey: ROLES.RESEPSIYON, resource: 'page:fraud', allowed: true },
    ];
    const perms = computeEffectivePermissions([ROLES.RESEPSIYON], overrides);
    // Override ile gelen
    expect(perms).toContain('page:fraud');
    // Registry'den varsayılan
    expect(perms).toContain('page:dashboard');
    expect(perms).toContain('page:patients');
  });

  it('toggle scenario: yönetici resepsiyona page:reports verir → effectivePerms yansıtır', () => {
    // Senaryo: yönetici PermissionsPage'de resepsiyon × page:reports toggle
    // → allow override yazılır → resepsiyon login/refresh sonrasında bu perm'i alır.
    const overrides: PermissionOverride[] = [
      { roleKey: ROLES.RESEPSIYON, resource: 'page:reports', allowed: true },
    ];
    const perms = computeEffectivePermissions([ROLES.RESEPSIYON], overrides);
    expect(perms).toContain('page:reports');
    // Default izinler korunmalı
    expect(perms).toContain('page:billing'); // resepsiyon Wave 319
  });
});

describe('v0.4 mod kavramı — kilitli mod izolasyonu (#537)', () => {
  it('mod katalog sabitleri tutarlı (kilitli ⊂ hemşire modları)', () => {
    expect(NURSE_MODES).toEqual(['genel', 'asistan', 'olcum']);
    // Her kilitli mod aynı zamanda bir hemşire modu olmalı (allowlist'i tanımlı).
    for (const m of LOCKED_MODES) {
      expect(NURSE_MODES as readonly string[]).toContain(m);
      expect(LOCKED_MODE_PERMISSIONS[m].length).toBeGreaterThan(0);
    }
  });

  it('isLockedMode yalnız kilitli modlar için true', () => {
    expect(isLockedMode('olcum')).toBe(true);
    expect(isLockedMode('genel')).toBe(false);
    expect(isLockedMode('asistan')).toBe(false);
    expect(isLockedMode(undefined)).toBe(false);
    expect(isLockedMode(null)).toBe(false);
    expect(isLockedMode('')).toBe(false);
  });

  it('hemşire + olcum modu = yalnız ölçüm istasyonu ekranları (eski olcum_hemsiresi ile eşdeğer)', () => {
    const locked = computeEffectivePermissions([ROLES.HEMSIRE], [], 'olcum');
    // Allowlist'teki 3 izin etkin (hemşire zaten hepsine sahip).
    expect(locked).toEqual(
      expect.arrayContaining([
        'page:measurementQueue',
        'action:measurementOrder.fulfill',
        'action:measurementOrder.list',
      ]),
    );
    // Kiosk dışı her şey bastırıldı (hemşire normalde bunlara sahip).
    expect(locked).not.toContain('page:dashboard');
    expect(locked).not.toContain('page:worklist');
    expect(locked).not.toContain('action:measurement.create');
    // Kilitli mod = eski olcum_hemsiresi rolünün etkili izin seti (geri-uyum).
    const legacy = computeEffectivePermissions([ROLES.OLCUM_HEMSIRESI], []);
    expect(new Set(locked)).toEqual(new Set(legacy));
  });

  it('kilitli mod yetki YÜKSELTMEZ — kullanıcı zaten sahip değilse allowlist erişim vermez', () => {
    // Resepsiyon allowlist izinlerinin hiçbirine sahip değil → kilitli sonuç boş.
    const locked = computeEffectivePermissions([ROLES.RESEPSIYON], [], 'olcum');
    expect(locked).toEqual([]);
    // Yönetici: measurementQueue + list var ama fulfill yok (allowlist ∩ sahip).
    const adminLocked = computeEffectivePermissions([ROLES.YONETICI], [], 'olcum');
    expect(adminLocked).toContain('page:measurementQueue');
    expect(adminLocked).toContain('action:measurementOrder.list');
    expect(adminLocked).not.toContain('action:measurementOrder.fulfill');
    expect(adminLocked).not.toContain('page:dashboard');
  });

  it('kilitsiz mod (genel/asistan) izinleri daraltmaz — mod yokmuş gibi', () => {
    const full = computeEffectivePermissions([ROLES.HEMSIRE], []);
    expect(computeEffectivePermissions([ROLES.HEMSIRE], [], 'genel')).toEqual(full);
    expect(computeEffectivePermissions([ROLES.HEMSIRE], [], 'asistan')).toEqual(full);
  });

  it('mod undefined → geriye uyumlu (klasik davranış)', () => {
    const withoutArg = computeEffectivePermissions([ROLES.HEMSIRE], []);
    const withUndefined = computeEffectivePermissions([ROLES.HEMSIRE], [], undefined);
    expect(withUndefined).toEqual(withoutArg);
  });
});

describe('resolveLoginMode — login-time mod çözümü (#539)', () => {
  it('0 mod + mod yok → ok/undefined (klasik)', () => {
    expect(resolveLoginMode([], undefined)).toEqual({ kind: 'ok', mode: undefined });
    expect(resolveLoginMode(undefined, undefined)).toEqual({ kind: 'ok', mode: undefined });
  });

  it('0 mod + mod gönderildi → invalid (not-allowed)', () => {
    expect(resolveLoginMode([], 'genel')).toEqual({ kind: 'invalid', reason: 'not-allowed' });
  });

  it('1 mod → otomatik seç (kiosk), mod gönderilmese de', () => {
    expect(resolveLoginMode(['olcum'], undefined)).toEqual({ kind: 'ok', mode: 'olcum' });
    expect(resolveLoginMode(['olcum'], 'olcum')).toEqual({ kind: 'ok', mode: 'olcum' });
  });

  it('1 mod + farklı mod istendi → invalid (unknown-mode)', () => {
    expect(resolveLoginMode(['olcum'], 'genel')).toEqual({
      kind: 'invalid',
      reason: 'unknown-mode',
    });
  });

  it('>1 mod + seçim yok → select (uygun modlar döner)', () => {
    expect(resolveLoginMode(['genel', 'asistan'], undefined)).toEqual({
      kind: 'select',
      availableModes: ['genel', 'asistan'],
    });
  });

  it('>1 mod + geçerli seçim → ok', () => {
    expect(resolveLoginMode(['genel', 'asistan', 'olcum'], 'asistan')).toEqual({
      kind: 'ok',
      mode: 'asistan',
    });
  });

  it('>1 mod + uygun olmayan seçim → invalid (unknown-mode)', () => {
    expect(resolveLoginMode(['genel', 'asistan'], 'olcum')).toEqual({
      kind: 'invalid',
      reason: 'unknown-mode',
    });
  });

  it('boş/çöp değerler filtrelenir', () => {
    // Tek geçerli mod kalırsa → otomatik seç.
    expect(resolveLoginMode(['', 'olcum'], undefined)).toEqual({ kind: 'ok', mode: 'olcum' });
  });
});

describe('v0.4 İP-9 (#545) — Finans Yetkilisi rol wiring', () => {
  const finans = computeEffectivePermissions([ROLES.FINANS], []);

  it('finans para ekran + aksiyonlarına sahip (tahsilat/kasa/onay/hakediş/fraud/rapor/PO onay)', () => {
    for (const p of [
      'page:billing',
      'page:cashRegister',
      'page:commission',
      'page:fraud',
      'page:approvals',
      'page:reports',
      'page:purchaseOrders',
      'action:po.approve',
      'action:approval.list',
      'action:approval.review',
      'action:commission.approve',
      'action:commission.markPaid',
      'action:payment.refundApprove',
      'action:payment.refundReverse',
      'action:invoice.create',
      'action:invoice.cancel',
      'action:payment.create',
      'action:cashRegister.close',
      'view:patient.invoices',
    ] as const) {
      expect(finans).toContain(p);
    }
  });

  it('finans klinik/yönetim ekranlarına sahip DEĞİL (görev ayrılığı + mali izolasyon)', () => {
    for (const p of [
      'page:patients',
      'page:users',
      'page:worklist',
      'action:examination.create',
      'action:patient.create',
      'action:po.create',
    ] as const) {
      expect(finans).not.toContain(p);
    }
  });
});

describe('v0.4 İP-10 (#546) — Stok & Satın Alma rol wiring', () => {
  const stok = computeEffectivePermissions([ROLES.STOK_SATINALMA], []);

  it('stok depo + tedarik + sipariş yetkilerine sahip (IOL/sarf/tedarikçi/PO)', () => {
    for (const p of [
      'page:iolInventory',
      'page:suppliers',
      'page:purchaseOrders',
      'action:iol.lotCreate',
      'action:iol.lotUpdate',
      'action:iol.modelCreate',
      'action:iol.movementCreate',
      'action:supplier.create',
      'action:supplier.update',
      'action:po.create',
      'action:po.submit',
      'action:po.receive',
      'action:po.cancel',
    ] as const) {
      expect(stok).toContain(p);
    }
  });

  it('stok PO ONAYLAYAMAZ + hasta/finans ekranları yok (görev ayrılığı + modül-kısıt)', () => {
    for (const p of [
      'action:po.approve',
      'page:billing',
      'page:cashRegister',
      'page:approvals',
      'page:fraud',
      'page:patients',
      'page:worklist',
      'action:patient.create',
    ] as const) {
      expect(stok).not.toContain(p);
    }
  });
});

describe('#561 güvenlik denetimi — doctor.create/update yalnız ADMIN_ROLES', () => {
  // tRPC doctor.create/update bare protectedProcedure'dı (herkes doktor kataloğu
  // ekleyebiliyordu); permissionProcedure('action:doctor.create'/'update') eklendi.
  for (const role of [ROLES.RESEPSIYON, ROLES.DOKTOR, ROLES.HEMSIRE, ROLES.AMELIYAT_SATIS]) {
    it(`${role} doktor oluşturamaz/düzenleyemez`, () => {
      const perms = computeEffectivePermissions([role], []);
      expect(perms).not.toContain('action:doctor.create');
      expect(perms).not.toContain('action:doctor.update');
    });
  }
  it('yonetici + asistan doktor oluşturup düzenleyebilir', () => {
    for (const role of [ROLES.YONETICI, ROLES.YONETICI_ASISTANI]) {
      const perms = computeEffectivePermissions([role], []);
      expect(perms).toContain('action:doctor.create');
      expect(perms).toContain('action:doctor.update');
    }
  });
  it('kilitli olcum modu doktor oluşturamaz (effectivePerms daraltması)', () => {
    // Kiosk: rolleri ne olursa olsun effectivePerms allowlist'e daralır.
    const locked = computeEffectivePermissions([ROLES.YONETICI, ROLES.HEMSIRE], [], 'olcum');
    expect(locked).not.toContain('action:doctor.create');
    expect(locked).not.toContain('action:doctor.update');
  });
});

describe('#663 güvenlik — klinik foto yükleme yalnız klinik personeli', () => {
  // PhotoController.upload artık @RequirePermission('action:photo.upload') gate'li
  // (önceden guard yoktu). Registry sınırı: yalnız doktor + hemşire. Hasta PROFIL
  // fotosu ayrı (action:patient.uploadPhoto, ön büro).
  it('doktor + hemşire klinik foto yükleyebilir', () => {
    expect(computeEffectivePermissions([ROLES.DOKTOR], [])).toContain('action:photo.upload');
    expect(computeEffectivePermissions([ROLES.HEMSIRE], [])).toContain('action:photo.upload');
  });
  it('yönetici/asistan/resepsiyon/satış + kilitli olcum klinik foto YÜKLEYEMEZ', () => {
    for (const role of [
      ROLES.YONETICI,
      ROLES.YONETICI_ASISTANI,
      ROLES.RESEPSIYON,
      ROLES.AMELIYAT_SATIS,
    ]) {
      expect(computeEffectivePermissions([role], [])).not.toContain('action:photo.upload');
    }
    const locked = computeEffectivePermissions([ROLES.HEMSIRE], [], 'olcum');
    expect(locked).not.toContain('action:photo.upload');
  });
});

describe('#664 güvenlik — eczane kasa devri görev ayrılığı (cashClose ≠ cashReconcile)', () => {
  it('eczane kasayı kapatır/teslim eder ama mutabakat YAPAMAZ', () => {
    const eczane = computeEffectivePermissions([ROLES.ECZANE], []);
    expect(eczane).toContain('action:pharmacy.cashClose');
    expect(eczane).not.toContain('action:pharmacy.cashReconcile');
  });
  it('finans mutabakat yapar ama kasayı kapatmaz (eczacının işi)', () => {
    const finans = computeEffectivePermissions([ROLES.FINANS], []);
    expect(finans).toContain('action:pharmacy.cashReconcile');
    expect(finans).not.toContain('action:pharmacy.cashClose');
  });
});

describe('v0.4.2 Karar 10 (#727) — Yönetici Asistanı operate-but-not-finalize', () => {
  const asistan = computeEffectivePermissions([ROLES.YONETICI_ASISTANI], []);

  it('onay LİSTELER + ekranını görür ama indirim ONAYLAYAMAZ (incele/eskale; finalize hidden)', () => {
    expect(asistan).toContain('page:approvals');
    expect(asistan).toContain('action:approval.list');
    expect(asistan).not.toContain('action:approval.review');
  });

  it('kasayı GÖRÜR + kapatma TASLAĞI hazırlar ama gün-sonu FINALIZE edemez (R5 #727)', () => {
    expect(asistan).toContain('page:cashRegister');
    expect(asistan).toContain('action:cashRegister.prepareDraft');
    expect(asistan).not.toContain('action:cashRegister.close');
  });

  it('IOL lens REZERVE eder (preOp.update) ama CONSUME edemez (registerLens doktor-only) (R5 #727)', () => {
    // Karar 10 IOL sınırı: reserve = preOp.update yan-etkisi (asistan yapar);
    // consume = surgery.registerLens (yalnız doktor — cerrahide lens implantı).
    expect(asistan).toContain('action:preOp.update');
    expect(asistan).not.toContain('action:surgery.registerLens');
  });

  it('iade/hakediş ONAYLAYAMAZ (yalnız yönetici + finans)', () => {
    expect(asistan).not.toContain('action:payment.refundApprove');
    expect(asistan).not.toContain('action:commission.approve');
  });

  it('yönetici + finans onay/kasa-finalize yapabilir (regresyon korumu)', () => {
    for (const role of [ROLES.YONETICI, ROLES.FINANS]) {
      const perms = computeEffectivePermissions([role], []);
      expect(perms).toContain('action:approval.review');
      expect(perms).toContain('action:cashRegister.close');
    }
  });

  it('doktor lens CONSUME edebilir (registerLens) — IOL boundary regresyon korumu', () => {
    const doktor = computeEffectivePermissions([ROLES.DOKTOR], []);
    expect(doktor).toContain('action:surgery.registerLens');
    expect(doktor).toContain('action:preOp.update');
  });
});
