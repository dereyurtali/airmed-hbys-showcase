/**
 * Permission registry — AirMed-HBYS rol/yetki tasarımının **TEK doğru kaynağı**.
 *
 * #936 (2026-07-03): eskiden `apps/api/src/auth/permissions.ts` (720) ↔
 * `apps/web/src/lib/permissions.ts` (784) elle senkronize mirror'dı; sapma olursa
 * UI buton gösterir ama API 403 döner (veya tersi sızıntı). Artık iki app da
 * `@airmed/contracts`'tan import eder → **yapısal olarak drift imkansız** (tek dosya).
 *
 * 3 katmanlı izin modeli: **page:** (sayfa/route+sidebar) · **view:** (bölüm/widget) ·
 * **action:** (mutation/aksiyon).
 *
 * Bölümler: (1) ROLES + rol-grupları + PERMISSIONS registry + hasPermission — iki app
 * ortak. (2) Mod/login çözümü (NURSE_MODES, LOCKED_MODE_PERMISSIONS, resolveLoginMode,
 * computeEffectivePermissions) — backend JWT üretiminde kullanılır. (3) PERMISSION_LABELS
 * + permissionLabel — web Permissions ekranı (TR etiket, sunum).
 *
 * Kaynak: `docs/audits/2026-05-27-role-permission-design.md`
 */

export const ROLES = {
  YONETICI: 'yonetici',
  YONETICI_ASISTANI: 'yonetici_asistani',
  DOKTOR: 'doktor',
  RESEPSIYON: 'resepsiyon',
  HEMSIRE: 'hemsire',
  // S12a — müşteri görüşmesi sonrası eklendi: cerrahi paket fatura+tahsilatı
  // ayrı pozisyon. Plain resepsiyon ameliyat tahsilatı kesmez (service rule).
  // Sözleşme amendment: 6 çekirdek rol.
  AMELIYAT_SATIS: 'ameliyat_satis',
  // S16 — Ölçüm odası istasyon rolü (dar/kilitli): yalnız ölçüm talepleri +
  // tamamlanan. ALL_ROLES/CLINICAL_ROLES'a EKLENMEZ.
  OLCUM_HEMSIRESI: 'olcum_hemsiresi',
  // v0.4 (#542) — 3 yeni rol. Yetki anahtarları aşağıda tek seferde tanımlanır
  // (çakışmasızlık sözleşmesi §2: tek sahip bu dosyayı yönetir). Detaylı rol↔ekran
  // wiring (mevcut finans/stok ekranlarına bu rolleri ekleme) İP-9/10/23'te.
  FINANS: 'finans',
  STOK_SATINALMA: 'stok_satinalma',
  ECZANE: 'eczane',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

const ALL_ROLES = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
] as const;

const ADMIN_ROLES = [ROLES.YONETICI, ROLES.YONETICI_ASISTANI] as const;
// v0.4 İP-9 (#545) — Finans Yetkilisi rol-grupları. Finans para işlerini tek elden
// yönetir → mevcut finansal yetkilere finans rolü eklenir. Görev ayrılığı PO
// approve guard'ında (oluşturan≠onaylayan, purchase-order.service.ts).
const FINANCE_ADMIN_ROLES = [...ADMIN_ROLES, ROLES.FINANS] as const; // admin + finans (rapor/komisyon/onay kuyruğu)
const FINANCE_OWNER_ROLES = [ROLES.YONETICI, ROLES.FINANS] as const; // yönetici + finans (iade/iptal/komisyon onay/fraud)
const FINANCE_DESK_ROLES = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.RESEPSIYON,
  ROLES.AMELIYAT_SATIS,
  ROLES.FINANS,
] as const; // ön büro + finans (faturalama/tahsilat/kasa)
// v0.4.2 Karar 10 (#727) — Yönetici Asistanı "operate-but-not-finalize": kasayı GÖRÜR
// + snapshot ile hazırlar ama gün-sonu FINALIZE edemez. Kapatma = ön büro/finans eksi
// asistan (FINANCE_DESK_ROLES − yonetici_asistani).
const CASH_FINALIZE_ROLES = [
  ROLES.YONETICI,
  ROLES.RESEPSIYON,
  ROLES.AMELIYAT_SATIS,
  ROLES.FINANS,
] as const;
// v0.4 İP-10 (#546) — Stok & Satın Alma: depo + tedarik. Mevcut IOL/sarf/tedarikçi
// yönetim yetkilerine stok rolü eklenir. Görev ayrılığı: stok PO oluşturur/gönderir
// ama ONAYLAMAZ (po.approve yalnız yönetici+finans); sipariş veren ≠ onaylayan.
const STOCK_ADMIN_ROLES = [...ADMIN_ROLES, ROLES.STOK_SATINALMA] as const; // admin + stok
const CLINICAL_ROLES = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.HEMSIRE,
] as const;

export const PERMISSIONS = {
  // Sayfa erişimi
  'page:dashboard': ALL_ROLES,
  'page:patients': ALL_ROLES,
  // Doktor diğer doktorları göremez (kendi profili dışında doktor yönetimi yok).
  'page:doctors': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.RESEPSIYON,
    ROLES.HEMSIRE,
    ROLES.AMELIYAT_SATIS,
  ],
  'page:schedule': ALL_ROLES,
  'page:changePassword': ALL_ROLES,
  'page:leads': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.RESEPSIYON],
  // Doktor stok göremez/takip edemez (IOL envanter + stok tahmin).
  'page:iolInventory': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.HEMSIRE,
    ROLES.STOK_SATINALMA,
  ],
  // Doktorda prosedürler kaldırıldı.
  'page:procedures': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI],
  // S15 — doktor iş kuyruğu (worklist). Asistan hemşire de erişir: aktif session
  // ile asiste ettiği doktorun kuyruğunu salt-okunur görür (server-side scope).
  'page:worklist': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.DOKTOR, ROLES.HEMSIRE],
  // S15 — doktor "Geçmiş Muayeneler" sayfası
  'page:pastExaminations': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.DOKTOR],
  // S15c — ölçüm birimi kuyruğu
  'page:measurementQueue': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.DOKTOR,
    ROLES.HEMSIRE,
    ROLES.OLCUM_HEMSIRESI,
  ],
  // S15 — ameliyat satış kuyruğu (devir)
  'page:surgerySales': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.AMELIYAT_SATIS],
  // S16 — Ameliyat satış: salt-okunur cerrahi paket kataloğu + planlı ameliyat takvimi.
  'page:surgeryCatalog': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.AMELIYAT_SATIS],
  'page:surgeryCalendar': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.AMELIYAT_SATIS],
  // S15-PR9 — Ameliyat Günü Merkezi (bugünkü ameliyatlar + safety + lens pipeline)
  'page:surgeryDay': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.DOKTOR, ROLES.HEMSIRE],
  // S15-PR13 — Public Waiting Monitor (lobby TV)
  'page:publicMonitor': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.RESEPSIYON,
    ROLES.DOKTOR,
    ROLES.HEMSIRE,
    ROLES.AMELIYAT_SATIS,
  ],
  // S15 — resepsiyon ödeme/yönlendirme kuyruğu
  'page:receptionQueue': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.RESEPSIYON],
  'page:reports': FINANCE_ADMIN_ROLES,
  'page:commission': FINANCE_ADMIN_ROLES,
  'page:messaging': ADMIN_ROLES,
  'page:fraud': FINANCE_OWNER_ROLES,
  // I2.2 — Geri-Bildirim Merkezi (#819)
  'page:feedbackCenter': [ROLES.YONETICI],
  'page:users': [ROLES.YONETICI],
  'page:consentTemplates': [ROLES.YONETICI],
  // S16+ — Sadece-yönetici hub sayfaları (kart-grid dispatcher).
  'page:adminAnalysis': [ROLES.YONETICI],
  'page:adminSettings': [ROLES.YONETICI],
  // S17 — Klinik bilgi yönetimi (ad, adres, telefon, logo). Yalnız yonetici.
  'page:clinicSettings': [ROLES.YONETICI],
  // EPIC #1018 — AI hasta asistanı: otomasyon izleme/yönetim ekranı + config
  // mutasyonları (aç/kapat, model, system prompt). Yalnız yonetici.
  'page:adminAutomations': [ROLES.YONETICI],
  'action:automation.manage': [ROLES.YONETICI],

  // İçerik görünürlüğü
  'view:patient.clinical_summary_card': ALL_ROLES,
  'view:patient.exam_timeline': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.DOKTOR],
  'view:patient.measurement_history': CLINICAL_ROLES,
  'view:patient.lab_history': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.DOKTOR],
  'view:patient.surgery_timeline': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.DOKTOR],
  // Procedure = klinik poliklinik işlemi (enjeksiyon/lazer); doktor kendi
  // işlem geçmişini görür (2026-06-02 kararı — önceki kaldırma geri alındı).
  'view:patient.procedure_timeline': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.DOKTOR],
  'view:patient.prescriptions': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.DOKTOR],
  // S10d 1.2 — Hemşire foto upload yapıyor (action:photo.upload setinde), galeriyi
  // göremezse kendi yüklediğini doğrulayamaz. Hemşire eklendi.
  'view:patient.photo_gallery': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.DOKTOR,
    ROLES.HEMSIRE,
  ],
  'view:patient.consents': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.DOKTOR,
    ROLES.RESEPSIYON,
  ],

  // Hasta CRUD
  // S10c — Yeni hasta kaydı SADECE front desk (resepsiyon) + admin (yönetici/asistan).
  // Doktor çıkartıldı: veri kalitesi (eksik telefon/adres), çift kayıt riski, KVKK
  // rıza süreci front-office iş akışı. Acil yedek senaryosu için admin override yeterli.
  'action:patient.create': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.RESEPSIYON],
  // Doktor şimdilik hasta bilgisini düzenleyemez (sadece görür) — front-office işi.
  'action:patient.update': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.RESEPSIYON],
  'action:patient.softDelete': [ROLES.YONETICI],
  'action:patient.hardDelete': [ROLES.YONETICI],

  // Klinik veri girişi
  // S10b — Yönetici "admin override" ihtiyacı: mevcut service guard'ları yonetici'ye
  // her clinical update/softDelete'te override sağlıyor. Registry servis truth ile
  // hizalandı; karar tutanağı §6 "yonetici doktor değil → klinik yok" idealdi ama
  // implementasyonla çelişiyordu, service kazanır.
  // examination/measurement update için yönetici override YOK — karar tutanağı
  // §6.2 (tıbbi veri yalnız klinik personeli). Surgery/lab admin override'a izinli.
  'action:examination.create': [ROLES.DOKTOR],
  'action:examination.update': [ROLES.DOKTOR],
  'action:measurement.create': [ROLES.DOKTOR, ROLES.HEMSIRE],
  'action:measurement.update': [ROLES.DOKTOR, ROLES.HEMSIRE],
  // Lab create klinik personeli (PRE_OP_WRITE_ROLES seti, servis truth)
  // S10e 5 — Resepsiyon çıkartıldı: lab isteği klinik karar (klinik bilgisi gerek).
  'action:lab.request': [ROLES.DOKTOR, ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.HEMSIRE],
  'action:lab.recordResult': [ROLES.DOKTOR, ROLES.YONETICI],
  // S15-P3 — Lab abnormal threshold yönetimi (yönetici + doktor).
  // Doktor lab referans aralıklarını göremez/yönetemez (kaldırıldı).
  'action:labThreshold.manage': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI],
  // S17 — Klinik bilgi güncelleme (ad, adres, telefon, logo). Yalnız yonetici.
  'action:clinicSettings.update': [ROLES.YONETICI],
  'action:surgery.create': [ROLES.DOKTOR],
  'action:surgery.update': [ROLES.DOKTOR, ROLES.YONETICI, ROLES.YONETICI_ASISTANI],
  'action:surgery.markCompleted': [ROLES.DOKTOR],
  'action:surgery.markComplication': [ROLES.DOKTOR],
  // S15-PR16 — Cerrahi reddi (hasta vazgeçti). Doktor + yönetici/asistanı.
  'action:surgery.markRefused': [ROLES.DOKTOR, ROLES.YONETICI, ROLES.YONETICI_ASISTANI],
  // R5 (#727) IOL boundary — CONSUME (lens implantı = stok consumedQty) yalnız
  // doktor. RESERVE (pre-op lens seçimi = reservedQty) action:preOp.update yan-
  // etkisidir ve yönetici asistanına AÇIKTIR (operate-but-not-finalize: rezerve
  // eder, cerrahide tüketmez). Sınır permissions.spec'te kilitli.
  'action:surgery.registerLens': [ROLES.DOKTOR],
  // S15-PR3 — WHO Surgical Safety Checklist confirm.
  // Ameliyathane ekibi: doktor (cerrah) + yönetici (denetleyici/asistan) +
  // hemşire (intra-op pause'ları başlatan). Resepsiyon dışarıda.
  'action:surgicalSafetyCheck.confirm': [
    ROLES.DOKTOR,
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.HEMSIRE,
  ],
  // R1 (#723) — Kalıcı problem + ilaç listesi yönetimi: klinisyen (doktor +
  // yönetici + asistan). Okuma protectedProcedure (RLS scoped).
  'action:problemList.manage': [ROLES.DOKTOR, ROLES.YONETICI, ROLES.YONETICI_ASISTANI],
  // Prescription: doktor + yonetici + asistan (service truth)
  'action:prescription.create': [ROLES.DOKTOR, ROLES.YONETICI, ROLES.YONETICI_ASISTANI],
  // Procedure: doktor + yonetici + asistan (service truth)
  // Klinik işlem (enjeksiyon/lazer) doktorun işi → doktor işlem kaydedebilir.
  'action:procedure.create': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.DOKTOR],
  'action:photo.upload': [ROLES.DOKTOR, ROLES.HEMSIRE],
  // S10e 4 — Karar tutanağı §6.2'ye geri çekildi: foto sil yalnız yönetici.
  // Doktor/hemşire kendi fotosunu yanlış yüklediyse yöneticiye söyler.
  'action:photo.delete': [ROLES.YONETICI],

  // #1049 — Personel dökümanları (CV/diploma/sertifika/sözleşme). İç İK
  // verisi (KVKK amaç ayrımı — hasta yüzeyine ASLA çıkmaz). Yönetim yalnız
  // yönetici. Görüntüleme registry'de yönetici; ilgili kullanıcı KENDİ
  // dökümanını her zaman görür (service-layer own-access, registry dışı).
  'action:staffDocument.manage': [ROLES.YONETICI],
  'view:staffDocument': [ROLES.YONETICI],

  // Onam — Karar 3 (v0.4.2): hemşire onam imzasını CAPTURE edebilir (idari;
  // hasta tablet'te imzalar, hemşire kaydeder). İçeriği değiştiremez — şablon
  // yönetimi `consentTemplate.manage` ile ayrı (klinik/yönetici).
  'action:consent.capture': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.DOKTOR, ROLES.HEMSIRE],

  // Randevu
  // Doktor randevu takvimini görür ama YENİ randevu veremez (front desk işi).
  'action:appointment.create': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.RESEPSIYON],
  'action:appointment.update': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.DOKTOR,
    ROLES.RESEPSIYON,
  ],
  'action:appointment.cancel': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.DOKTOR,
    ROLES.RESEPSIYON,
  ],
  'action:appointment.checkin': ALL_ROLES,
  // S10d 1.3 — markDone = ziyaret tamamlandı (doktor sorumluluğu, muayene bitti).
  // checkout = front-office tamamladı (faturalama). Ayrı kavramlar, ayrı perm.
  'action:appointment.markDone': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.DOKTOR,
    ROLES.RESEPSIYON,
  ],
  'action:appointment.checkout': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.RESEPSIYON],

  // S15 — Encounter (ziyaret akışı / istasyon yolculuğu)
  // open: resepsiyon check-in'de ziyaret açar (admin de). advance: istasyon geçişleri
  // (resepsiyon→doktora/ölçüme gönder, doktor muayeneye başla/ameliyat-satışa, hemşire
  // ölçüm tamamla); yasal geçiş tablosu + service-layer rol kontrolü ile sınırlanır.
  'action:encounter.open': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.RESEPSIYON],
  'action:encounter.advance': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.DOKTOR,
    ROLES.RESEPSIYON,
    ROLES.HEMSIRE,
  ],
  'action:encounter.close': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.DOKTOR,
    ROLES.RESEPSIYON,
  ],
  'action:encounter.receptionList': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.RESEPSIYON],
  // S15-PR5 — Break Glass acil bypass: sadece yönetici (KVKK + tıbbi
  // sorumluluk; sebep ≥10 char, audit trail Encounter satırında).
  'action:encounter.emergencyBypass': [ROLES.YONETICI],
  // S15-PR10 — Hemşire "Acting on Behalf" session yönetimi.
  'action:nurseSession.manage': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.HEMSIRE],
  'action:nurseSession.revoke': [ROLES.YONETICI],
  // S15-PR23 — Doktor adına yapılan işlemlerin co-sign onayı.
  'action:audit.cosign': [ROLES.DOKTOR, ROLES.YONETICI, ROLES.YONETICI_ASISTANI],

  // S15c — Ölçüm sipariş akışı. #363 — asistan hemşire de talep girebilir,
  // ama yalnız doktora aktif asiste (acting-on-behalf) ediyorsa; bu acting
  // bağlamı router'da resolveActingDoctorUserId ile zorlanır (tek başına
  // hemşire rolü yetmez).
  // Karar 3 (v0.4.2): ölçüm talebi oluşturma = klinik karar (yalnız doktor).
  // Hemşire ölçümü YAPAR (fulfill) ama TALEP ETMEZ. (Web zaten [DOKTOR]; bu API
  // drift'ini düzeltir — hemşire backend'de de oluşturamaz.)
  'action:measurementOrder.create': [ROLES.DOKTOR],
  'action:measurementOrder.fulfill': [ROLES.DOKTOR, ROLES.HEMSIRE, ROLES.OLCUM_HEMSIRESI],
  'action:measurementOrder.list': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.DOKTOR,
    ROLES.HEMSIRE,
    ROLES.OLCUM_HEMSIRESI,
  ],

  // S15 — ameliyat satış kuyruğu (devir listesi)
  'action:surgery.handoffList': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.AMELIYAT_SATIS],

  // Doktor profili
  // Doktor diğer doktorları listeleyemez/göremez (kendi profili → doctor.myProfile).
  'action:doctor.list': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.RESEPSIYON,
    ROLES.HEMSIRE,
    ROLES.AMELIYAT_SATIS,
  ],
  'action:doctor.create': ADMIN_ROLES,
  'action:doctor.update': ADMIN_ROLES,
  // S10e 6 — Sadece yönetici: doktor hesabı kapatma personel kararı, mali sorumluluk
  'action:doctor.softDelete': [ROLES.YONETICI],
  'action:doctor.setAvailability': ADMIN_ROLES,
  // S10d 2.1 — Doktor izin/tatil yönetimi admin işi (önceden perm guard yoktu,
  // herkes ekleyebiliyor/silebiliyordu). Resepsiyon/hemşire takvim düzenleyemez.
  'action:doctor.addLeave': ADMIN_ROLES,
  'action:doctor.deleteLeave': ADMIN_ROLES,

  // Sistem yönetimi (sadece yönetici)
  'action:apiKey.create': [ROLES.YONETICI],
  'action:apiKey.update': [ROLES.YONETICI],
  'action:apiKey.revoke': [ROLES.YONETICI],
  'action:apiKey.rotate': [ROLES.YONETICI],
  'action:user.list': [ROLES.YONETICI],
  'action:user.create': [ROLES.YONETICI],
  'action:user.update': [ROLES.YONETICI],
  'action:user.resetPassword': [ROLES.YONETICI],
  // Pasifleştirme + yeniden etkinleştirme aynı izin altında (status toggle).
  'action:user.deactivate': [ROLES.YONETICI],
  'action:consentTemplate.manage': [ROLES.YONETICI],
  'action:fraud.editRule': [ROLES.YONETICI],
  'action:export.excel': [ROLES.YONETICI],
  'action:export.pdf': [ROLES.YONETICI],
  // I2.2 — Geri-Bildirim Merkezi (#819)
  'action:feedback.create': [ROLES.YONETICI],
  'action:feedback.manage': [ROLES.YONETICI],

  // Sistem yönetimi (asistana açık)
  'action:messaging.configureTrigger': ADMIN_ROLES,
  'action:messaging.updateTemplate': ADMIN_ROLES,
  'action:commission.editRule': FINANCE_ADMIN_ROLES,
  // S10e 1 — Mali kontrol ayrılığı: hesaplama operasyonel (asistan), onay+ödeme
  // yönetici son sözü. Asistan calculate edebilir, yönetici approve/markPaid.
  'action:commission.markPaid': FINANCE_OWNER_ROLES,
  'action:lead.create': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.RESEPSIYON],
  'action:lead.update': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.RESEPSIYON],

  // IOL stok
  'action:iol.lotCreate': STOCK_ADMIN_ROLES,
  'action:iol.lotUpdate': STOCK_ADMIN_ROLES,
  'action:iol.modelCreate': STOCK_ADMIN_ROLES,

  // S10b — Router migration için ek aksiyon izinleri
  // Pharmacy / Suppliers
  'action:supplier.create': STOCK_ADMIN_ROLES,
  'action:supplier.update': STOCK_ADMIN_ROLES,
  'action:supplier.softDelete': [ROLES.YONETICI],
  'action:prescription.update': [ROLES.DOKTOR, ROLES.YONETICI, ROLES.YONETICI_ASISTANI],
  'action:prescription.softDelete': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.DOKTOR],
  'action:prescription.send': [ROLES.DOKTOR, ROLES.YONETICI],

  // Surgery / Examination / Measurement softDelete
  'action:surgery.softDelete': [ROLES.YONETICI],
  'action:examination.softDelete': [ROLES.YONETICI, ROLES.DOKTOR],
  'action:measurement.softDelete': [ROLES.YONETICI, ROLES.DOKTOR, ROLES.HEMSIRE],

  // Onam revoke — service tarafında ADMIN_ROLES=['yonetici'] (yasal sorumluluk)
  'action:consent.revoke': [ROLES.YONETICI],

  // IOL ekleri
  'action:iol.modelUpdate': STOCK_ADMIN_ROLES,
  'action:iol.modelSoftDelete': [ROLES.YONETICI],
  'action:iol.lotSoftDelete': [ROLES.YONETICI],
  'action:iol.movementCreate': STOCK_ADMIN_ROLES,

  // Procedure
  'action:procedure.update': [ROLES.DOKTOR, ROLES.YONETICI, ROLES.YONETICI_ASISTANI],
  'action:procedure.softDelete': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.DOKTOR],

  // Lab
  // S10e 3 — Sıkılaştır: hemşire/resepsiyon çıkartıldı. Service strict (owner+admin+24h);
  // UI'da düzenle butonu hemşire/resepsiyona görünmesin, 403 UX bozukluğu kapatıldı.
  'action:lab.update': [ROLES.DOKTOR, ROLES.YONETICI, ROLES.YONETICI_ASISTANI],
  'action:lab.softDelete': [ROLES.YONETICI, ROLES.DOKTOR],

  // Photo update (uploader + yonetici override; service strict check)
  'action:photo.update': [ROLES.DOKTOR, ROLES.HEMSIRE, ROLES.YONETICI],

  // Pre-op / Post-op (cerrahi akış)
  // PRE_OP_WRITE_ROLES = doktor + yonetici + asistan + hemsire (service truth)
  'action:preOp.create': [ROLES.DOKTOR, ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.HEMSIRE],
  'action:preOp.update': [ROLES.DOKTOR, ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.HEMSIRE],
  'action:preOp.markReady': [ROLES.DOKTOR, ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.HEMSIRE],
  // unmarkReady + softDelete sadece yönetici (service guard)
  'action:preOp.unmarkReady': [ROLES.YONETICI],
  'action:preOp.softDelete': [ROLES.YONETICI],
  'action:postOp.scheduleFollowUps': [ROLES.DOKTOR, ROLES.YONETICI, ROLES.YONETICI_ASISTANI],
  'action:postOp.deleteFollowUps': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.DOKTOR],
  // S15-PR20 — Recall (post-op takip kayıp hastalar)
  'action:recall.list': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.RESEPSIYON,
    ROLES.DOKTOR,
    ROLES.HEMSIRE,
  ],
  'action:recall.logAttempt': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.RESEPSIYON,
    ROLES.HEMSIRE,
  ],

  // Fraud (yönetici-only, mali hassasiyet)
  'action:fraud.updateAlertStatus': [ROLES.YONETICI],
  'action:fraud.scanNow': [ROLES.YONETICI],

  // Commission iş akışı
  // S10e 1 — Hesaplama + reddetme operasyonel (asistan dahil); approve mali son söz (yönetici)
  'action:commission.calculate': FINANCE_ADMIN_ROLES,
  'action:commission.approve': FINANCE_OWNER_ROLES,
  'action:commission.reject': FINANCE_ADMIN_ROLES,

  // ===========================================================================
  // S11c — Billing modülü (tasarım: docs/audits/2026-05-28-tahsilat-modul-tasarimi.md)
  // S12a — müşteri görüşmesi: ameliyat_satis rolü billing perm'lerine eklendi
  // (docs/audits/2026-05-28-fahri-toplantisi-sonrasi.md). Service-layer rule:
  // invoice.surgeryId set ise [yön+asistan+ameliyat_satis] zorunlu (plain resep yok).
  // ===========================================================================
  // Sayfa erişimleri
  // S12c sonrası resepsiyon faturalama + kasa sahibi. "Önce öde sonra hizmet"
  // kuralı (assertPaidSession) resepsiyonun tahsilat ekranına ulaşabilmesini
  // zorunlu kıldı. action:invoice.create / action:payment.create resepsiyonda
  // zaten vardı; page:billing + page:cashRegister listeleri tutarlı hale geldi.
  // Service catalog tanımı yönetici özel kalır.
  'page:billing': FINANCE_DESK_ROLES,
  'page:serviceCatalog': [ROLES.YONETICI],
  'page:cashRegister': FINANCE_DESK_ROLES,

  // İçerik görünürlüğü — doktor finansa bakmaz (faturalar gizli) — 2026-06-02.
  'view:patient.invoices': FINANCE_DESK_ROLES,
  'view:patient.openBalance': FINANCE_DESK_ROLES,

  // Aksiyon — fatura (base; surgeryId binding service-layer'da kontrol)
  'action:invoice.create': FINANCE_DESK_ROLES,
  'action:invoice.update': FINANCE_DESK_ROLES,
  'action:invoice.cancel': FINANCE_OWNER_ROLES,

  // Aksiyon — tahsilat (surgery bağlı invoice için service kontrol eder)
  'action:payment.create': FINANCE_DESK_ROLES,
  'action:payment.refund': FINANCE_OWNER_ROLES,

  // S15-PR15b — 2-aşama iade akışı.
  // request: resepsiyon + asistan + yönetici (talep).
  // approve/reject: yalnız yönetici (mali kapı).
  // reverse: yalnız yönetici (24h içinde geri al).
  'action:payment.refundRequest': FINANCE_DESK_ROLES,
  'action:payment.refundApprove': FINANCE_OWNER_ROLES,
  'action:payment.refundReverse': FINANCE_OWNER_ROLES,

  // Aksiyon — kasa (her iki sayman da kapat)
  'action:cashRegister.close': CASH_FINALIZE_ROLES, // Karar 10: asistan finalize edemez (snapshot/hazırlık açık)
  'action:cashRegister.prepareDraft': FINANCE_DESK_ROLES, // R5 #727: asistan dahil kapatma TASLAĞI hazırlar (finalize değil)

  'action:serviceItem.create': [ROLES.YONETICI],
  'action:serviceItem.update': [ROLES.YONETICI],
  'action:serviceItem.softDelete': [ROLES.YONETICI],

  // ===========================================================================
  // S14 — v0.1 indirim onayı + Dashboard layout + Permissions matrisi UI port
  // (Plan: /Users/alid/.claude/plans/bunlar-n-hepsini-uygun-bir-joyful-melody.md)
  // ===========================================================================
  // Onaylar sayfası — admin pozisyonu (mali son söz)
  'page:approvals': FINANCE_ADMIN_ROLES,
  // Yetkiler ekranı (rol × ekran × indirim matrisi) — yalnız sahip
  'page:permissions': [ROLES.YONETICI],

  // Onay aksiyonları (review = approve/reject) — admin
  'action:approval.list': FINANCE_ADMIN_ROLES, // asistan dahil — Karar 10: incele + eskale görünür
  'action:approval.review': FINANCE_OWNER_ROLES, // Karar 10: asistan onaylayamaz/reddedemez (yalnız yönetici + finans)

  // Webhook yönetimi — yalnız yönetici (anahtar paritesi: dış sistem entegrasyonu)
  'action:webhook.create': [ROLES.YONETICI],
  'action:webhook.update': [ROLES.YONETICI],
  'action:webhook.revoke': [ROLES.YONETICI],
  'action:webhook.list': [ROLES.YONETICI],

  // Dashboard layout — kullanıcı kendi rolünün default'unu okur; save admin
  'action:dashboard.getLayout': ALL_ROLES,
  'action:dashboard.saveLayout': [ROLES.YONETICI],

  // Permission matrisi — yalnız sahip
  'action:permission.matrixRead': [ROLES.YONETICI],
  'action:permission.matrixWrite': [ROLES.YONETICI],

  // ===========================================================================
  // v0.4 (#542, İP-6) — Tedarik · Satın Alma · Eczane yetki anahtarları.
  // EPIC sabit isimleri (sözleşme): rota /suppliers, /purchase-orders[/approvals],
  // /pharmacy/*. Anahtarlar tek seferde burada (Ali); ekranları İP-11..23 yapar.
  // Rol↔mevcut ekran wiring (finans→faturalama, stok→IOL/sarf) İP-9/10'da.
  // ===========================================================================

  // Tedarikçiler (mevcut Supplier backend; UI İP-11)
  'page:suppliers': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.STOK_SATINALMA],

  // Satın Alma Siparişleri (PO) — İP-12/13/14
  'page:purchaseOrders': [
    ROLES.YONETICI,
    ROLES.YONETICI_ASISTANI,
    ROLES.STOK_SATINALMA,
    ROLES.FINANS,
  ],
  'action:po.create': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.STOK_SATINALMA],
  'action:po.submit': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.STOK_SATINALMA],
  // Görev ayrılığı: PO onayı finans + yönetici; service-layer "oluşturan ≠
  // onaylayan" guard'ı İP-13'te bunun üstüne eklenir.
  'action:po.approve': [ROLES.YONETICI, ROLES.FINANS],
  'action:po.receive': [ROLES.YONETICI, ROLES.YONETICI_ASISTANI, ROLES.STOK_SATINALMA],
  'action:po.cancel': [ROLES.YONETICI, ROLES.STOK_SATINALMA],

  // Eczane perakende (8 ekran + aksiyonlar) — İP-15..23
  'page:pharmacyPos': [ROLES.YONETICI, ROLES.ECZANE],
  'page:pharmacyPrescriptions': [ROLES.YONETICI, ROLES.ECZANE],
  'page:pharmacyStock': [ROLES.YONETICI, ROLES.ECZANE],
  'page:pharmacyIntake': [ROLES.YONETICI, ROLES.ECZANE],
  'page:pharmacySuppliers': [ROLES.YONETICI, ROLES.ECZANE],
  // Eczane kasası + raporları finans da görür (gün sonu mutabakat teslimi).
  'page:pharmacyCash': [ROLES.YONETICI, ROLES.ECZANE, ROLES.FINANS],
  'page:pharmacyReturns': [ROLES.YONETICI, ROLES.ECZANE],
  'page:pharmacyReports': [ROLES.YONETICI, ROLES.ECZANE, ROLES.FINANS],
  'action:pharmacy.sale': [ROLES.YONETICI, ROLES.ECZANE],
  'action:pharmacy.return': [ROLES.YONETICI, ROLES.ECZANE],
  'action:pharmacy.cashClose': [ROLES.YONETICI, ROLES.ECZANE],
  // #664 — 2-aşama kasa devri: finans mutabakatı. Eczacı (cashClose) ≠ mutabakat
  // eden (cashReconcile = yönetici + finans). Görev ayrılığı service guard'da da.
  'action:pharmacy.cashReconcile': [ROLES.YONETICI, ROLES.FINANS],
  'action:pharmacy.stockAdjust': [ROLES.YONETICI, ROLES.ECZANE],
} as const satisfies Record<string, readonly Role[]>;

// S12a — Cerrahi tahsilatı yetkili rol seti (service-layer guard için).
// invoice.surgeryId set olduğunda actor.roles bu seti içermelidir.
export const SURGERY_BILLING_ROLES: readonly Role[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.AMELIYAT_SATIS,
];

export type Permission = keyof typeof PERMISSIONS;

// =============================================================================
// v0.4 — Çalışma Modu (mod) kavramı (#537, İP-1)
// -----------------------------------------------------------------------------
// "Rol" kalıcı yetki paketidir (ne yapabilir). "Mod" girişte seçilen oturumluk
// kipliktir (bugün hangi işteyim). Bir hemşire aynı kişi olarak Genel / Asistan
// / Ölçüm modlarında çalışabilir; rolü değişmez, oturumun görünürlüğü değişir.
//
// Kilitli (kiosk) mod: masada açık kalan ölçüm istasyonu gibi — o oturumda
// kullanıcının başka rolleri/izinleri olsa da YALNIZ o moda ait ekran görünür
// (kiosk izolasyonu). Kilitsiz modlar yetkiyi daraltmaz (klasik davranış).
// =============================================================================

/** Hemşire rolünün seçebildiği modlar (girişte seçilir). */
export const NURSE_MODES = ['genel', 'asistan', 'olcum'] as const;
export type NurseMode = (typeof NURSE_MODES)[number];

/**
 * Kilitli (kiosk) modlar — bu moda giren oturum, izinlerini moda ait alt-kümeye
 * daraltır; diğer rollerin izinleri bastırılır. Şimdilik tek kilitli mod: ölçüm
 * istasyonu (`olcum`).
 */
export const LOCKED_MODES = ['olcum'] as const;
export type LockedMode = (typeof LOCKED_MODES)[number];

/**
 * Kilitli mod → o oturumda görünür izin allowlist'i. Etkili izin seti =
 * hesaplanan izinler ∩ bu allowlist (yalnız daraltır, asla yetki yükseltmez:
 * kullanıcı zaten sahip değilse allowlist'te olması erişim vermez).
 *
 * `olcum` = ölçüm istasyonu kiosk'u. Eski `olcum_hemsiresi` rolüyle BİREBİR aynı
 * ekran kümesi → geri-uyum: "hemşire + olcum modu" === eski ölçüm hemşiresi
 * (#538 veri göçü bu eşitliğe dayanır).
 */
export const LOCKED_MODE_PERMISSIONS: Record<LockedMode, readonly Permission[]> = {
  olcum: [
    'page:measurementQueue',
    'action:measurementOrder.fulfill',
    'action:measurementOrder.list',
  ],
};

/** Verilen değer kilitli bir mod mu? (type guard) */
export function isLockedMode(mode: string | null | undefined): mode is LockedMode {
  return mode != null && (LOCKED_MODES as readonly string[]).includes(mode);
}

/**
 * Login-time mod çözümü (#539). Kullanıcının seçebildiği modlar (flags.modes)
 * ile istemcinin gönderdiği modu karşılaştırıp ne yapılacağını döner. Saf
 * fonksiyon (Nest bağımsız) — birim test edilebilir; çağıran katman sonucu
 * HTTP davranışına çevirir (invalid → 400, select → mod seçici, ok → token).
 *
 *  - 0 mod  → klasik kullanıcı. İstemci mod gönderdiyse `invalid` (mod kavramı yok).
 *  - 1 mod  → otomatik seç (kiosk). Farklı mod istenirse `invalid`.
 *  - >1 mod → istemci seçmeli. Mod yoksa `select` (uygun modlar döner); geçersizse
 *             `invalid`; geçerliyse `ok`.
 */
export type LoginModeResolution =
  | { kind: 'ok'; mode?: string }
  | { kind: 'select'; availableModes: string[] }
  | { kind: 'invalid'; reason: 'not-allowed' | 'unknown-mode' };

export function resolveLoginMode(
  availableModes: readonly string[] | undefined,
  requested: string | undefined,
): LoginModeResolution {
  const modes = (availableModes ?? []).filter((m) => typeof m === 'string' && m.length > 0);
  if (modes.length === 0) {
    return requested ? { kind: 'invalid', reason: 'not-allowed' } : { kind: 'ok', mode: undefined };
  }
  if (modes.length === 1) {
    if (requested && requested !== modes[0]) return { kind: 'invalid', reason: 'unknown-mode' };
    return { kind: 'ok', mode: modes[0] };
  }
  if (!requested) return { kind: 'select', availableModes: modes };
  if (!modes.includes(requested)) return { kind: 'invalid', reason: 'unknown-mode' };
  return { kind: 'ok', mode: requested };
}

/**
 * Runtime izin kontrolü. 3 öncelik sırası:
 *
 * 1. `effectivePerms` set'i geçilirse (login'de JWT'ye gömülen, override
 *    uygulanmış kullanıcı-spesifik liste) yalnız bu set'e bakılır.
 *    Override yansıması için **kanonik yol** budur.
 * 2. `effectivePerms` undefined (legacy token / unit test) ise rol-tabanlı
 *    registry kontrolüne düşer. PermissionAssignment override'ı bilinemez,
 *    sadece varsayılan rol matrisine bakılır.
 *
 * UI mirror'ı (`apps/web/src/lib/permissions.ts`) aynı imzayı taşır.
 */
export function hasPermission(
  userRoles: readonly string[],
  perm: Permission,
  effectivePerms?: readonly string[],
): boolean {
  if (effectivePerms) {
    return effectivePerms.includes(perm);
  }
  const allowed = PERMISSIONS[perm] as readonly string[];
  return userRoles.some((r) => allowed.includes(r));
}

/**
 * Login + refresh sırasında çağrılır. Kullanıcı rollerine göre registry'deki
 * varsayılan izinler hesaplanır + `permission_assignments` tablosundaki tenant
 * override'ları uygulanır. Sonuç olarak kullanıcının "etkili" izin seti elde
 * edilir; bu set JWT'ye `effectivePerms` claim'i olarak gömülür.
 *
 * Override semantiği (per role):
 *  - override.allowed=true  → bu rol için izin verilir (varsayılan yokken bile)
 *  - override.allowed=false → bu rol için reddedilir (varsayılan varken bile)
 *  - override yoksa         → registry varsayılanı geçerli
 *
 * Birden fazla rol → OR: herhangi bir rolde izin etkili ise sonuç true.
 *
 * Performans: tenant başına ~7 rol × ~300 perm = 2100 cell, tek findMany ile
 * çekildikten sonra in-memory join. Klinikte 50 kullanıcı × 6 login/gün = 300
 * çağrı/gün → ihmal edilebilir maliyet, cache'siz gidiyoruz.
 */
export interface PermissionOverride {
  roleKey: string;
  resource: string;
  allowed: boolean;
}

export function computeEffectivePermissions(
  userRoles: readonly string[],
  overrides: readonly PermissionOverride[],
  // v0.4 (#537) — Girişte seçilen çalışma modu. Kilitli mod ise sonuç o moda ait
  // allowlist ile kesiştirilir (kiosk izolasyonu). undefined/kilitsiz → daraltma yok.
  mode?: string | null,
): Permission[] {
  // overrideMap: resource → roleKey → allowed
  const overrideMap = new Map<string, Map<string, boolean>>();
  for (const ov of overrides) {
    if (!overrideMap.has(ov.resource)) overrideMap.set(ov.resource, new Map());
    overrideMap.get(ov.resource)!.set(ov.roleKey, ov.allowed);
  }

  const result: Permission[] = [];
  for (const perm of Object.keys(PERMISSIONS) as Permission[]) {
    const defaultAllowed = PERMISSIONS[perm] as readonly string[];
    const resourceOverrides = overrideMap.get(perm);
    const granted = userRoles.some((role) => {
      const ov = resourceOverrides?.get(role);
      return ov ?? defaultAllowed.includes(role);
    });
    if (granted) result.push(perm);
  }

  // Kilitli mod: etkili izinleri moda ait allowlist ile kesiştir. Kullanıcının
  // başka rolleri kiosk dışı izinler getirse de bu adım bastırır.
  if (isLockedMode(mode)) {
    const allow = new Set<string>(LOCKED_MODE_PERMISSIONS[mode]);
    return result.filter((perm) => allow.has(perm));
  }
  return result;
}
// ─────────────────────────────────────────────────────────────────────────────
// Permissions ekranı için insan-okur etiketler (TR).
// Kaynak: docs/audits/2026-05-27-role-permission-design.md + S14 yetkiler UI.
// Eksik bir resource gelirse fallback raw key döner; konsol uyarısı ile fark
// edilir → buraya eklenir. Mirror veya backend'a duplikasyon gerekmiyor (UI-only).
// ─────────────────────────────────────────────────────────────────────────────
export const PERMISSION_LABELS: Record<string, string> = {
  // Sayfa erişimi
  'page:dashboard': 'Pano (ana ekran)',
  'page:patients': 'Hasta listesi',
  'page:doctors': 'Doktor listesi',
  'page:schedule': 'Randevu takvimi',
  'page:pastExaminations': 'Geçmiş muayeneler',
  'page:changePassword': 'Şifre değiştir',
  'page:leads': 'Aday hasta (lead) listesi',
  'page:iolInventory': 'IOL (göz içi mercek) stoğu',
  'page:procedures': 'İşlemler / prosedürler',
  'page:reports': 'Raporlar',
  'page:commission': 'Doktor hakediş',
  'page:messaging': 'Hasta mesajlaşma',
  'page:fraud': 'Sahtekarlık uyarıları',
  'page:feedbackCenter': 'Geri-Bildirim Merkezi',
  'page:users': 'Personel yönetimi',
  'page:consentTemplates': 'Onam şablonları',
  'page:billing': 'Faturalama / tahsilat',
  'page:serviceCatalog': 'Hizmet kataloğu (fiyat listesi)',
  'page:surgeryCatalog': 'Ameliyat kataloğu (paket fiyatları)',
  'page:surgeryCalendar': 'Ameliyat takvimi (planlı ameliyatlar)',
  'page:cashRegister': 'Kasa',
  'page:approvals': 'İndirim onayları',
  'page:permissions': 'Yetkiler ekranı',

  // İçerik görünürlüğü (hasta dosyası bölümleri)
  'view:patient.clinical_summary_card': 'Hasta dosyası — klinik özet kartı',
  'view:patient.exam_timeline': 'Hasta dosyası — muayene geçmişi',
  'view:patient.measurement_history': 'Hasta dosyası — ölçüm geçmişi',
  'view:patient.lab_history': 'Hasta dosyası — lab sonuçları',
  'view:patient.surgery_timeline': 'Hasta dosyası — ameliyat geçmişi',
  'view:patient.procedure_timeline': 'Hasta dosyası — işlem geçmişi',
  'view:patient.prescriptions': 'Hasta dosyası — reçeteler',
  'view:patient.photo_gallery': 'Hasta dosyası — fotoğraf galerisi',
  'view:patient.consents': 'Hasta dosyası — imzalı onam belgeleri',
  'view:patient.invoices': 'Hasta dosyası — faturalar',
  'view:patient.openBalance': 'Hasta dosyası — açık bakiye (borç)',

  // Hasta
  'action:patient.create': 'Yeni hasta kaydı oluştur',
  'action:patient.update': 'Hasta bilgilerini düzenle',
  'action:patient.softDelete': 'Hastayı arşive al',
  'action:patient.hardDelete': 'Hastayı kalıcı sil',

  // Muayene / ölçüm / lab
  'action:examination.create': 'Muayene kaydı oluştur',
  'action:examination.update': 'Muayene kaydını güncelle',
  'action:examination.softDelete': 'Muayene kaydını arşive al',
  'action:measurement.create': 'Ölçüm girişi yap',
  'action:measurement.update': 'Ölçüm girişini düzenle',
  'action:measurement.softDelete': 'Ölçüm girişini arşive al',
  'action:lab.request': 'Lab tetkiki iste',
  'action:lab.recordResult': 'Lab sonucu gir',
  'action:lab.update': 'Lab kaydını düzenle',
  'action:lab.softDelete': 'Lab kaydını arşive al',

  // Cerrahi
  'action:surgery.create': 'Ameliyat planla',
  'action:surgery.update': 'Ameliyat kaydını güncelle',
  'action:surgery.markCompleted': 'Ameliyatı tamamlandı işaretle',
  'action:surgery.markComplication': 'Komplikasyon kaydet',
  'action:surgery.markRefused': 'Ameliyat reddedildi (hasta vazgeçti) olarak işaretle',
  'action:surgery.registerLens': 'Takılan göz içi merceği (IOL) kaydet',
  'action:surgicalSafetyCheck.confirm': 'Cerrahi güvenlik kontrol listesi maddesi onayla',
  'action:surgery.softDelete': 'Ameliyatı arşive al',
  'action:preOp.create': 'Ameliyat öncesi (pre-op) değerlendirme oluştur',
  'action:preOp.update': 'Pre-op değerlendirmeyi güncelle',
  'action:preOp.markReady': 'Hastayı ameliyata hazır işaretle',
  'action:preOp.unmarkReady': 'Hazır işaretini geri al',
  'action:preOp.softDelete': 'Pre-op kaydı arşive al',
  'action:postOp.scheduleFollowUps': 'Ameliyat sonrası (post-op) kontrolleri planla',
  'action:recall.list': 'Post-op takip listesini görüntüle (kayıp/yaklaşan kontroller)',
  'action:recall.logAttempt': 'Hasta hatırlatma denemesini kaydet (SMS/telefon/email)',
  'action:postOp.deleteFollowUps': 'Post-op kontrolü sil',

  // Reçete / işlem / foto / onam
  'action:problemList.manage': 'Problem/ilaç listesi yönet',
  'action:prescription.create': 'Reçete oluştur',
  'action:prescription.update': 'Reçeteyi düzenle',
  'action:prescription.softDelete': 'Reçeteyi arşive al',
  'action:prescription.send': 'Reçeteyi hastaya gönder',
  'action:procedure.create': 'İşlem (prosedür) kaydı oluştur',
  'action:procedure.update': 'İşlem kaydını düzenle',
  'action:procedure.softDelete': 'İşlemi arşive al',
  'action:photo.upload': 'Hasta fotoğrafı yükle',
  'action:photo.update': 'Fotoğraf bilgisini düzenle (etiket vb.)',
  'action:photo.delete': 'Fotoğrafı sil',
  'action:staffDocument.manage': 'Personel dökümanı yükle/sil (CV, diploma vb.)',
  'view:staffDocument': 'Personel dökümanlarını görüntüle',
  'action:consent.capture': 'Onam imzası al (capture)',
  'action:consent.revoke': 'Onamı iptal et',

  // Randevu
  'action:appointment.create': 'Yeni randevu oluştur',
  'action:appointment.update': 'Randevuyu güncelle',
  'action:appointment.cancel': 'Randevuyu iptal et',
  'action:appointment.checkin': 'Hastayı check-in yap (kliniğe geldi)',
  'action:appointment.markDone': 'Randevuyu tamamlandı işaretle (doktor)',
  'action:appointment.checkout': 'Randevuyu kapat (kasa / fatura)',

  // Doktor profili
  'action:doctor.list': 'Doktor listesini görüntüle',
  'action:doctor.create': 'Yeni doktor profili ekle',
  'action:doctor.update': 'Doktor profilini düzenle',
  'action:doctor.softDelete': 'Doktoru pasifleştir',
  'action:doctor.setAvailability': 'Doktor müsaitliği (haftalık takvim) belirle',
  'action:doctor.addLeave': 'Doktor izni ekle',
  'action:doctor.deleteLeave': 'Doktor iznini sil',

  // Personel & sistem
  'action:user.list': 'Personel listesini görüntüle',
  'action:user.create': 'Yeni personel hesabı aç',
  'action:user.update': 'Personel bilgisini düzenle',
  'action:user.resetPassword': 'Personel şifresini sıfırla',
  'action:user.deactivate': 'Personeli pasifleştir / yeniden etkinleştir',
  'action:apiKey.create': 'API anahtarı oluştur',
  'action:apiKey.update': 'API anahtarını düzenle',
  'action:apiKey.revoke': 'API anahtarını iptal et',
  'action:apiKey.rotate': 'API anahtarını yenile (rotate)',
  'action:consentTemplate.manage': 'Onam şablonlarını yönet',
  'action:export.excel': "Excel'e dışa aktar",
  'action:export.pdf': "PDF'e dışa aktar",
  'action:feedback.create': 'Geri-bildirim gönder',
  'action:feedback.manage': 'Geri-bildirim yönet',

  // Sahtekarlık tespiti
  'action:fraud.editRule': 'Sahtekarlık kuralı düzenle',
  'action:fraud.updateAlertStatus': 'Sahtekarlık uyarı durumunu güncelle',
  'action:fraud.scanNow': 'Sahtekarlık taramasını şimdi başlat',

  // Mesajlaşma
  'action:messaging.configureTrigger': 'Mesaj tetikleyicisi ayarla',
  'action:messaging.updateTemplate': 'Mesaj şablonunu düzenle',

  // Hakediş (komisyon)
  'action:commission.editRule': 'Hakediş kuralı düzenle',
  'action:commission.calculate': 'Hakediş hesapla',
  'action:commission.approve': 'Hakediş onayla',
  'action:commission.reject': 'Hakedişi reddet',
  'action:commission.markPaid': 'Hakedişi ödendi işaretle',

  // Aday hasta (lead)
  'action:lead.create': 'Aday hasta kaydı oluştur',
  'action:lead.update': 'Aday hasta bilgisini düzenle',

  // IOL stok
  'action:iol.lotCreate': 'IOL parti kaydı oluştur',
  'action:iol.lotUpdate': 'IOL parti kaydını güncelle',
  'action:iol.lotSoftDelete': 'IOL partisini arşive al',
  'action:iol.modelCreate': 'IOL modeli ekle',
  'action:iol.modelUpdate': 'IOL modelini düzenle',
  'action:iol.modelSoftDelete': 'IOL modelini arşive al',
  'action:iol.movementCreate': 'IOL stok hareketi kaydet',

  // Tedarikçi
  'action:supplier.create': 'Tedarikçi ekle',
  'action:supplier.update': 'Tedarikçi bilgisini düzenle',
  'action:supplier.softDelete': 'Tedarikçiyi pasifleştir',

  // Faturalama / tahsilat
  'action:invoice.create': 'Fatura oluştur',
  'action:invoice.update': 'Faturayı düzenle',
  'action:invoice.cancel': 'Faturayı iptal et',
  'action:payment.create': 'Tahsilat yap (ödeme al)',
  'action:payment.refund': 'Tahsilat iadesi yap',
  'action:payment.refundRequest': 'İade talebi oluştur (yönetici onayı bekler)',
  'action:payment.refundApprove': 'İade talebini onayla / reddet',
  'action:payment.refundReverse': 'Onaylanan iadeyi 24 saat içinde geri al',
  'action:cashRegister.close': 'Kasayı kapat (gün sonu sayım)',
  'action:cashRegister.prepareDraft': 'Kasa kapatma taslağı hazırla',
  'action:serviceItem.create': 'Hizmet kalemi ekle (fiyat listesi)',
  'action:serviceItem.update': 'Hizmet kalemini düzenle',
  'action:serviceItem.softDelete': 'Hizmet kalemini pasifleştir',

  // Onay akışı (indirim onayı vb.)
  'action:approval.list': 'Onay bekleyen istekleri listele',
  'action:approval.review': 'Onay incele (kabul / reddet)',

  // Webhook (dış sistem entegrasyonu)
  'action:webhook.create': 'Webhook (dış bildirim) ekle',
  'action:webhook.update': "Webhook'u düzenle",
  'action:webhook.revoke': "Webhook'u iptal et",
  'action:webhook.list': "Webhook'ları listele",

  // Pano (dashboard) düzeni
  'action:dashboard.getLayout': 'Pano düzenini yükle',
  'action:dashboard.saveLayout': 'Pano düzenini kaydet (rol için varsayılan)',

  // Yetkiler ekranı
  'action:permission.matrixRead': 'Yetki matrisini görüntüle',
  'action:permission.matrixWrite': 'Yetki matrisini düzenle',

  // v0.4 (#542) — Tedarik · Satın Alma · Eczane
  'page:suppliers': 'Tedarikçiler',
  'page:purchaseOrders': 'Satın alma siparişleri',
  'action:po.create': 'Satın alma siparişi oluştur',
  'action:po.submit': 'Satın alma siparişini onaya gönder',
  'action:po.approve': 'Satın alma siparişini onayla',
  'action:po.receive': 'Mal kabul (siparişi teslim al → stok)',
  'action:po.cancel': 'Satın alma siparişini iptal et',
  'page:pharmacyPos': 'Eczane satış (kasa/POS)',
  'page:pharmacyPrescriptions': 'Eczane reçete kuyruğu',
  'page:pharmacyStock': 'Eczane stoğu',
  'page:pharmacyIntake': 'Eczane mal kabul',
  'page:pharmacySuppliers': 'Eczane tedarikçileri',
  'page:pharmacyCash': 'Eczane kasası (gün sonu)',
  'page:pharmacyReturns': 'Eczane iade',
  'page:pharmacyReports': 'Eczane satış raporları',
  'action:pharmacy.sale': 'Eczane satışı yap',
  'action:pharmacy.return': 'Eczane iadesi işle',
  'action:pharmacy.cashClose': 'Eczane kasasını kapat (finansa teslim)',
  'action:pharmacy.cashReconcile': 'Eczane kasa mutabakatı (finans onayı)',
  'action:pharmacy.stockAdjust': 'Eczane stok düzeltmesi yap',
};

/**
 * Bir izin kaynağı için TR insan-okur etiket döndürür. Sözlükte yoksa raw key
 * döner (konsol uyarısıyla) → eksik etiket fark edilince PERMISSION_LABELS'a eklenir.
 */
export function permissionLabel(resource: string): string {
  const label = PERMISSION_LABELS[resource];
  if (!label) {
    if (typeof console !== 'undefined') {
      console.warn(`[permissions] eksik TR etiket: ${resource}`);
    }
    return resource;
  }
  return label;
}
