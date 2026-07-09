import { describe, expect, it } from 'vitest';
import { hasPermission, PERMISSIONS, ROLES, type Permission, type Role } from './permissions';

describe('permissions registry — karar tutanağı doğrulaması', () => {
  describe('Katman 1 — sayfa erişimi', () => {
    it('fraud: sadece yönetici (Karar 6 mali hassasiyet)', () => {
      expect(hasPermission([ROLES.YONETICI], 'page:fraud')).toBe(true);
      expect(hasPermission([ROLES.YONETICI_ASISTANI], 'page:fraud')).toBe(false);
      expect(hasPermission([ROLES.DOKTOR], 'page:fraud')).toBe(false);
      expect(hasPermission([ROLES.RESEPSIYON], 'page:fraud')).toBe(false);
      expect(hasPermission([ROLES.HEMSIRE], 'page:fraud')).toBe(false);
    });

    it('users / consentTemplates: sadece yönetici', () => {
      for (const perm of ['page:users', 'page:consentTemplates'] as const) {
        expect(hasPermission([ROLES.YONETICI], perm)).toBe(true);
        expect(hasPermission([ROLES.YONETICI_ASISTANI], perm)).toBe(false);
      }
    });

    it('leads: doktor + hemşire dışı (klinik akış işi)', () => {
      expect(hasPermission([ROLES.RESEPSIYON], 'page:leads')).toBe(true);
      expect(hasPermission([ROLES.DOKTOR], 'page:leads')).toBe(false);
      expect(hasPermission([ROLES.HEMSIRE], 'page:leads')).toBe(false);
    });

    it('iolInventory: yönetici + hemşire (doktor stok göremez)', () => {
      expect(hasPermission([ROLES.YONETICI], 'page:iolInventory')).toBe(true);
      expect(hasPermission([ROLES.HEMSIRE], 'page:iolInventory')).toBe(true);
      // Doktor stok göremez/takip edemez.
      expect(hasPermission([ROLES.DOKTOR], 'page:iolInventory')).toBe(false);
      expect(hasPermission([ROLES.RESEPSIYON], 'page:iolInventory')).toBe(false);
    });

    it('dashboard / patients / schedule: hepsi (doctors hariç)', () => {
      const allRoles: Role[] = [
        ROLES.YONETICI,
        ROLES.YONETICI_ASISTANI,
        ROLES.DOKTOR,
        ROLES.RESEPSIYON,
        ROLES.HEMSIRE,
      ];
      const universal = ['page:dashboard', 'page:patients', 'page:schedule'] as const;
      for (const role of allRoles) {
        for (const perm of universal) {
          expect(hasPermission([role], perm)).toBe(true);
        }
      }
      // Doktor diğer doktorları göremez (page:doctors); diğer roller görür.
      expect(hasPermission([ROLES.DOKTOR], 'page:doctors')).toBe(false);
      expect(hasPermission([ROLES.YONETICI], 'page:doctors')).toBe(true);
      expect(hasPermission([ROLES.RESEPSIYON], 'page:doctors')).toBe(true);
    });

    it('doktor erişim kısıtlamaları (yeni kural): doktor şunları yapamaz', () => {
      // Diğer doktorları listeleyemez/göremez
      expect(hasPermission([ROLES.DOKTOR], 'action:doctor.list')).toBe(false);
      // Yeni randevu veremez (takvimi görür)
      expect(hasPermission([ROLES.DOKTOR], 'action:appointment.create')).toBe(false);
      // Stok göremez
      expect(hasPermission([ROLES.DOKTOR], 'page:iolInventory')).toBe(false);
      // Standalone prosedür liste sayfası doktorda yok (erişim hasta-detay timeline'ında).
      expect(hasPermission([ROLES.DOKTOR], 'page:procedures')).toBe(false);
      // Doktor finansa bakmaz: hasta faturaları + açık bakiye gizli (2026-06-02).
      expect(hasPermission([ROLES.DOKTOR], 'view:patient.invoices')).toBe(false);
      expect(hasPermission([ROLES.DOKTOR], 'view:patient.openBalance')).toBe(false);
      // Hasta demografik bilgisini düzenleyemez (sadece görür).
      expect(hasPermission([ROLES.DOKTOR], 'action:patient.update')).toBe(false);
    });

    it('doktor klinik işlem (procedure) görür + kaydeder (2026-06-02 kararı)', () => {
      // Procedure = klinik poliklinik işlemi (enjeksiyon/lazer) → doktorun işi.
      expect(hasPermission([ROLES.DOKTOR], 'view:patient.procedure_timeline')).toBe(true);
      expect(hasPermission([ROLES.DOKTOR], 'action:procedure.create')).toBe(true);
      expect(hasPermission([ROLES.DOKTOR], 'action:procedure.update')).toBe(true);
      // Erişim hasta-merkezli; standalone /prosedurler sayfası yine kapalı.
      expect(hasPermission([ROLES.DOKTOR], 'page:procedures')).toBe(false);
    });

    it('resepsiyon faturalama + kasa sayfalarına erişir (S12c "önce öde sonra hizmet")', () => {
      // S12c sonrası klinik akışı: hasta → fatura → tahsilat → muayene.
      // assertPaidSession resepsiyondan tahsilat alınmadıkça doktoru bloklar,
      // bu yüzden resepsiyonun /billing + /cash-register ekranlarına ulaşması
      // şart. action:invoice.create + action:payment.create zaten resepsiyonda
      // mevcut; page:* listeleri eşleşmiyordu (önceki "şimdilik kaldırıldı"
      // notu) → düzeltildi.
      expect(hasPermission([ROLES.RESEPSIYON], 'page:billing')).toBe(true);
      expect(hasPermission([ROLES.RESEPSIYON], 'page:cashRegister')).toBe(true);
      expect(hasPermission([ROLES.RESEPSIYON], 'action:invoice.create')).toBe(true);
      expect(hasPermission([ROLES.RESEPSIYON], 'action:payment.create')).toBe(true);
      // Hizmet kataloğu tanımı yönetici özel kalır (kalem fiyat/komisyon kararı).
      expect(hasPermission([ROLES.RESEPSIYON], 'page:serviceCatalog')).toBe(false);
      // Fatura iptali + iade onayı yönetici özel (S15-PR15b 2-aşama).
      expect(hasPermission([ROLES.RESEPSIYON], 'action:invoice.cancel')).toBe(false);
      expect(hasPermission([ROLES.RESEPSIYON], 'action:payment.refund')).toBe(false);
      expect(hasPermission([ROLES.RESEPSIYON], 'action:payment.refundApprove')).toBe(false);
      // Doktor finansa girmez (2026-06-02 kararı korunur).
      expect(hasPermission([ROLES.DOKTOR], 'page:billing')).toBe(false);
      expect(hasPermission([ROLES.DOKTOR], 'page:cashRegister')).toBe(false);
    });

    it('asistan hemşire worklist (Muayene Sırası) görür ama salt-okunur (2026-06-02)', () => {
      // Hemşire asiste ettiği doktorun kuyruğuna erişir (server-side scope).
      expect(hasPermission([ROLES.HEMSIRE], 'page:worklist')).toBe(true);
      expect(hasPermission([ROLES.DOKTOR], 'page:worklist')).toBe(true);
      expect(hasPermission([ROLES.YONETICI], 'page:worklist')).toBe(true);
      // Ön büro / ameliyat satış worklist görmez.
      expect(hasPermission([ROLES.RESEPSIYON], 'page:worklist')).toBe(false);
      expect(hasPermission([ROLES.AMELIYAT_SATIS], 'page:worklist')).toBe(false);
      // Worklist'teki doktor-düzeyi aksiyonları hemşire YAPAMAZ (butonlar gizli).
      expect(hasPermission([ROLES.HEMSIRE], 'action:prescription.create')).toBe(false);
      expect(hasPermission([ROLES.HEMSIRE], 'action:surgery.create')).toBe(false);
      expect(hasPermission([ROLES.HEMSIRE], 'action:measurementOrder.create')).toBe(false);
      expect(hasPermission([ROLES.HEMSIRE], 'action:encounter.close')).toBe(false);
    });

    it('Karar 3: hemşire onam capture EVET / ölçüm talebi HAYIR', () => {
      // Onam imzası capture (idari) — hemşire yapabilir.
      expect(hasPermission([ROLES.HEMSIRE], 'action:consent.capture')).toBe(true);
      expect(hasPermission([ROLES.DOKTOR], 'action:consent.capture')).toBe(true);
      expect(hasPermission([ROLES.YONETICI], 'action:consent.capture')).toBe(true);
      // Şablon yönetimi (içerik) hemşireye kapalı.
      expect(hasPermission([ROLES.HEMSIRE], 'action:consentTemplate.manage')).toBe(false);
      // Ölçüm talebi oluşturma = klinik karar (doktor); hemşire fulfill eder, talep etmez.
      expect(hasPermission([ROLES.HEMSIRE], 'action:measurementOrder.create')).toBe(false);
      expect(hasPermission([ROLES.HEMSIRE], 'action:measurementOrder.fulfill')).toBe(true);
    });

    it('ölçüm hemşiresi kilitli istasyon (S16): yalnız ölçüm talepleri + tamamlanan', () => {
      // Erişebildiği: ölçüm kuyruğu + listeleme + sonuç girme (fulfill).
      expect(hasPermission([ROLES.OLCUM_HEMSIRESI], 'page:measurementQueue')).toBe(true);
      expect(hasPermission([ROLES.OLCUM_HEMSIRESI], 'action:measurementOrder.list')).toBe(true);
      expect(hasPermission([ROLES.OLCUM_HEMSIRESI], 'action:measurementOrder.fulfill')).toBe(true);
      // Kilitli: dashboard/hasta/takvim/stok/worklist YOK (ALL_ROLES'a eklenmedi).
      expect(hasPermission([ROLES.OLCUM_HEMSIRESI], 'page:dashboard')).toBe(false);
      expect(hasPermission([ROLES.OLCUM_HEMSIRESI], 'page:patients')).toBe(false);
      expect(hasPermission([ROLES.OLCUM_HEMSIRESI], 'page:schedule')).toBe(false);
      expect(hasPermission([ROLES.OLCUM_HEMSIRESI], 'page:iolInventory')).toBe(false);
      expect(hasPermission([ROLES.OLCUM_HEMSIRESI], 'page:worklist')).toBe(false);
      // Ölçüm siparişini doktor açar; ölçüm hemşiresi oluşturamaz.
      expect(hasPermission([ROLES.OLCUM_HEMSIRESI], 'action:measurementOrder.create')).toBe(false);
    });
  });

  describe('Katman 2 — içerik görünürlüğü', () => {
    it('resepsiyon klinik özet kartı görür ama detay timeline görmez (Karar 1)', () => {
      expect(hasPermission([ROLES.RESEPSIYON], 'view:patient.clinical_summary_card')).toBe(true);
      expect(hasPermission([ROLES.RESEPSIYON], 'view:patient.exam_timeline')).toBe(false);
      expect(hasPermission([ROLES.RESEPSIYON], 'view:patient.surgery_timeline')).toBe(false);
      expect(hasPermission([ROLES.RESEPSIYON], 'view:patient.prescriptions')).toBe(false);
      expect(hasPermission([ROLES.RESEPSIYON], 'view:patient.photo_gallery')).toBe(false);
      // Onam imza durumu sadece görünür (read-only)
      expect(hasPermission([ROLES.RESEPSIYON], 'view:patient.consents')).toBe(true);
    });

    it('hemşire lab GÖRMEZ ama ölçüm GÖRÜR (Karar 2)', () => {
      expect(hasPermission([ROLES.HEMSIRE], 'view:patient.lab_history')).toBe(false);
      expect(hasPermission([ROLES.HEMSIRE], 'view:patient.measurement_history')).toBe(true);
      // Diğerleri de görmez
      expect(hasPermission([ROLES.HEMSIRE], 'view:patient.exam_timeline')).toBe(false);
      expect(hasPermission([ROLES.HEMSIRE], 'view:patient.surgery_timeline')).toBe(false);
    });
  });

  describe('Katman 3 — aksiyon yetkisi', () => {
    it('asistan API key oluşturamaz (Karar 4)', () => {
      expect(hasPermission([ROLES.YONETICI_ASISTANI], 'action:apiKey.create')).toBe(false);
      expect(hasPermission([ROLES.YONETICI], 'action:apiKey.create')).toBe(true);
    });

    it('asistan hasta silemez (Karar 5)', () => {
      expect(hasPermission([ROLES.YONETICI_ASISTANI], 'action:patient.softDelete')).toBe(false);
      expect(hasPermission([ROLES.YONETICI_ASISTANI], 'action:patient.hardDelete')).toBe(false);
      expect(hasPermission([ROLES.YONETICI], 'action:patient.softDelete')).toBe(true);
      expect(hasPermission([ROLES.YONETICI], 'action:patient.hardDelete')).toBe(true);
    });

    it('reçete yazma: doktor + admin override (S10b service truth hizalama)', () => {
      expect(hasPermission([ROLES.DOKTOR], 'action:prescription.create')).toBe(true);
      // S10b: yönetici + asistan admin override (service truth: PharmacyService
      // izin veriyor; registry hizalandı). Hemşire YOK.
      expect(hasPermission([ROLES.YONETICI], 'action:prescription.create')).toBe(true);
      expect(hasPermission([ROLES.YONETICI_ASISTANI], 'action:prescription.create')).toBe(true);
      expect(hasPermission([ROLES.HEMSIRE], 'action:prescription.create')).toBe(false);
      expect(hasPermission([ROLES.RESEPSIYON], 'action:prescription.create')).toBe(false);
    });

    it('ölçüm girişi: doktor + hemşire (Karar 2)', () => {
      expect(hasPermission([ROLES.DOKTOR], 'action:measurement.create')).toBe(true);
      expect(hasPermission([ROLES.HEMSIRE], 'action:measurement.create')).toBe(true);
      expect(hasPermission([ROLES.RESEPSIYON], 'action:measurement.create')).toBe(false);
    });

    it('foto upload doktor + hemşire, sil yalnız yönetici', () => {
      expect(hasPermission([ROLES.DOKTOR], 'action:photo.upload')).toBe(true);
      expect(hasPermission([ROLES.HEMSIRE], 'action:photo.upload')).toBe(true);
      expect(hasPermission([ROLES.YONETICI], 'action:photo.delete')).toBe(true);
      expect(hasPermission([ROLES.DOKTOR], 'action:photo.delete')).toBe(false);
    });

    it('export sadece yönetici (Karar 9)', () => {
      expect(hasPermission([ROLES.YONETICI], 'action:export.excel')).toBe(true);
      expect(hasPermission([ROLES.YONETICI_ASISTANI], 'action:export.excel')).toBe(false);
    });

    it('check-in herkesi içeriyor ama check-out hemşire/doktor hariç', () => {
      expect(hasPermission([ROLES.HEMSIRE], 'action:appointment.checkin')).toBe(true);
      expect(hasPermission([ROLES.DOKTOR], 'action:appointment.checkin')).toBe(true);
      expect(hasPermission([ROLES.HEMSIRE], 'action:appointment.checkout')).toBe(false);
      expect(hasPermission([ROLES.DOKTOR], 'action:appointment.checkout')).toBe(false);
    });
  });

  describe('registry sağlığı', () => {
    it('her permission en az bir rola izin verir', () => {
      const keys = Object.keys(PERMISSIONS) as Permission[];
      for (const k of keys) {
        const allowed = PERMISSIONS[k] as readonly string[];
        expect(allowed.length).toBeGreaterThan(0);
      }
    });

    it('boş rol listesi hiçbir permission vermiyor', () => {
      const keys = Object.keys(PERMISSIONS) as Permission[];
      for (const k of keys) {
        expect(hasPermission([], k)).toBe(false);
      }
    });
  });

  describe('effectivePerms öncelikli mod (PermissionAssignment runtime)', () => {
    it('effectivePerms verilirse rol/registry yok sayılır', () => {
      // Resepsiyon registry'de page:fraud yetkisine sahip değil; ama
      // effectivePerms set'i bunu içeriyorsa true (allow override etkili).
      expect(
        hasPermission([ROLES.RESEPSIYON], 'page:fraud', ['page:fraud', 'page:dashboard']),
      ).toBe(true);

      // Yönetici registry'de page:billing'e sahip; effectivePerms bunu
      // dışlıyorsa false (deny override etkili).
      expect(hasPermission([ROLES.YONETICI], 'page:billing', ['page:dashboard'])).toBe(false);
    });

    it('effectivePerms undefined → registry fallback (legacy/deploy öncesi)', () => {
      expect(hasPermission([ROLES.YONETICI], 'page:billing')).toBe(true);
      expect(hasPermission([ROLES.DOKTOR], 'page:billing')).toBe(false);
    });

    it('boş effectivePerms tüm izinleri reddeder', () => {
      // Boş array undefined değil; öncelik sırası gereği effectivePerms'e bakılır.
      expect(hasPermission([ROLES.YONETICI], 'page:dashboard', [])).toBe(false);
    });
  });
});
