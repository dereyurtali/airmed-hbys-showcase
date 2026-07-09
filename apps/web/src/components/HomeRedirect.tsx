import { Navigate } from 'react-router-dom';
import { ROLES } from '@airmed/contracts';
import { getSidebarVariant } from '../lib/sidebar-variant';
import { useAuth } from '../providers/AuthProvider';

// S15 — Rol-bazlı açılış. Sadece-doktor → "Muayene Sırası"; sadece-resepsiyon →
// "Karşılama & Ödeme". Çoklu-rol (mixed) → /overview: OverviewPage taşınan
// rollerden en öncelikliyi çözer (#908; eski jenerik /dashboard panosu emekli).
const NON_DOCTOR_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
  ROLES.OLCUM_HEMSIRESI,
];
const NON_RECEPTION_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
  ROLES.OLCUM_HEMSIRESI,
];
// S16 — Sadece-ölçüm hemşiresi (kilitli istasyon) → "Ölçüm Talepleri".
const NON_MEASUREMENT_NURSE_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
];
// S16 — Sadece-ameliyat satış → "Satış Hattı".
const NON_SALES_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.OLCUM_HEMSIRESI,
];
// #403 — Sadece-asistan hemşire → "Muayene Sırası" (iş ekranı). Eskiden panoya
// düşüyordu; hemşirenin asıl ekranı asiste ettiği doktorun worklist'i.
const NON_NURSE_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.AMELIYAT_SATIS,
  ROLES.OLCUM_HEMSIRESI,
];
// v0.4 #559 — Sadece-eczane personeli → "Eczane Satış" (POS).
const NON_ECZANE_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
  ROLES.OLCUM_HEMSIRESI,
];
// v0.4 İP-9 (#545) — Sadece-finans → "Faturalama/Tahsilat" (gelir akışının ana ekranı).
const NON_FINANS_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
  ROLES.OLCUM_HEMSIRESI,
  ROLES.ECZANE,
  ROLES.STOK_SATINALMA,
];
// v0.4 İP-10 (#546) — Sadece-stok&satınalma → "Mal Kabul / Stok Hareketleri".
const NON_STOK_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
  ROLES.OLCUM_HEMSIRESI,
  ROLES.ECZANE,
  ROLES.FINANS,
];

export function HomeRedirect() {
  const { user } = useAuth();
  // v0.4 (#541/#544) — Çalışma modu varsa açılış sayfasını mod belirler (rolden
  // önce). Migrasyon sonrası kullanıcı hem hemsire hem olcum_hemsiresi rolü
  // taşıyabildiğinden mod tek doğru sinyal.
  //  - olcum (kilitli kiosk) → Ölçüm Talepleri (tek ekran)
  //  - genel → Ölçüm Talepleri (klinik-geneli hemşire görevleri; #544)
  //  - asistan → İş kuyruğu (asiste edilen doktorun worklist'i)
  if (user?.mode === 'olcum' || user?.mode === 'genel')
    return <Navigate to="/measurement-queue" replace />;
  if (user?.mode === 'asistan') return <Navigate to="/worklist" replace />;
  // Solo-yönetici → "Genel Bakış" (sidebar'da pinned-top /overview). #726:
  // eskiden /dashboard'a düşüyordu (AdminOverviewPage göstererek), ama pinned-top
  // menü öğesi /overview olduğundan açılışta hiçbir menü aktif görünmüyordu.
  // getSidebarVariant === 'admin' = OverviewPage'in AdminOverviewPage gösterdiği
  // koşulun aynısı → tek kanonik overview yolu.
  if (user && getSidebarVariant(user.roles, user.mode) === 'admin')
    return <Navigate to="/overview" replace />;
  const isDoctorOnly =
    !!user &&
    user.roles.includes(ROLES.DOKTOR) &&
    !user.roles.some((r) => NON_DOCTOR_ROLES.includes(r));
  const isReceptionOnly =
    !!user &&
    user.roles.includes(ROLES.RESEPSIYON) &&
    !user.roles.some((r) => NON_RECEPTION_ROLES.includes(r));
  const isMeasurementNurseOnly =
    !!user &&
    user.roles.includes(ROLES.OLCUM_HEMSIRESI) &&
    !user.roles.some((r) => NON_MEASUREMENT_NURSE_ROLES.includes(r));
  const isSalesOnly =
    !!user &&
    user.roles.includes(ROLES.AMELIYAT_SATIS) &&
    !user.roles.some((r) => NON_SALES_ROLES.includes(r));
  const isNurseOnly =
    !!user &&
    user.roles.includes(ROLES.HEMSIRE) &&
    !user.roles.some((r) => NON_NURSE_ROLES.includes(r));
  const isEczaneOnly =
    !!user &&
    user.roles.includes(ROLES.ECZANE) &&
    !user.roles.some((r) => NON_ECZANE_ROLES.includes(r));
  const isFinansOnly =
    !!user &&
    user.roles.includes(ROLES.FINANS) &&
    !user.roles.some((r) => NON_FINANS_ROLES.includes(r));
  const isStokOnly =
    !!user &&
    user.roles.includes(ROLES.STOK_SATINALMA) &&
    !user.roles.some((r) => NON_STOK_ROLES.includes(r));
  const target = isDoctorOnly
    ? '/worklist'
    : isReceptionOnly
      ? '/reception-queue'
      : isMeasurementNurseOnly
        ? '/measurement-queue'
        : isSalesOnly
          ? '/surgery-sales'
          : isNurseOnly
            ? '/worklist'
            : isEczaneOnly
              ? '/pharmacy/pos'
              : isFinansOnly
                ? '/billing'
                : isStokOnly
                  ? '/inventory/iol'
                  : '/overview';
  return <Navigate to={target} replace />;
}
