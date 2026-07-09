import { useTranslation } from 'react-i18next';
import { useAuth } from '../providers/AuthProvider';
import { getSidebarVariant } from '../lib/sidebar-variant';
import { ROLES } from '@airmed/contracts';
import { AdminOverviewPage } from './AdminOverviewPage';
import { AssistantOverview } from './overview/AssistantOverview';
import { DoctorOverview } from './overview/DoctorOverview';
import { NurseOverview } from './overview/NurseOverview';
import { MeasurementKioskOverview } from './overview/MeasurementKioskOverview';
import { ReceptionOverview } from './overview/ReceptionOverview';
import { SalesOverview } from './overview/SalesOverview';
import { FinansOverview } from './overview/FinansOverview';
import { StokOverview } from './overview/StokOverview';
import { EczaneOverview } from './overview/EczaneOverview';
import { OverviewShell } from '../components/overview';

/**
 * Rol-aware "Genel Bakış" landing. Sidebar'da her varyantta pinned-top (#721 G2).
 * Dağıtım `getSidebarVariant` (kanonik rol/mod→varyant) ile yapılır:
 * - admin → mevcut zengin AdminOverviewPage
 * - diğer varyantlar → iskelet (R1-R9 kendi içeriğini yerine koyar)
 */

function RoleOverviewPlaceholder() {
  const { t } = useTranslation('common');
  return (
    <OverviewShell>
      <div
        data-testid="overview-placeholder"
        className="rounded-xl border border-dashed bg-muted/30 p-8 text-center"
      >
        <p className="text-sm text-muted-foreground">{t('overview.placeholder')}</p>
      </div>
    </OverviewShell>
  );
}

export function OverviewPage() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const variant = getSidebarVariant(roles, user?.mode);

  // Yönetici Asistanı (yonetici DEĞİL) → 'full' varyantına düşer; ona özel view-only
  // triage overview. Yönetici de taşıyan çoklu-rol kullanıcı bu daldan geçmez.
  if (roles.includes(ROLES.YONETICI_ASISTANI) && !roles.includes(ROLES.YONETICI)) {
    return <AssistantOverview />;
  }

  if (variant === 'admin') return <AdminOverviewPage />;
  if (variant === 'doctor') return <DoctorOverview />;
  if (variant === 'nurse') return <NurseOverview />;
  if (variant === 'measurement-nurse') return <MeasurementKioskOverview />;
  if (variant === 'reception') return <ReceptionOverview />;
  if (variant === 'sales') return <SalesOverview />;
  if (variant === 'finans') return <FinansOverview />;
  if (variant === 'stok') return <StokOverview />;
  if (variant === 'pharmacy') return <EczaneOverview />;

  // Çoklu-rol (mixed) kullanıcı → tek 'full' varyantına düşer; kendi tekil rol
  // overview'ı yoktur. #908: eski jenerik /dashboard panosu emekliye ayrıldı →
  // taşıdığı rollerden EN ÖNCELİKLİsinin hazır Genel Bakış'ına indirilir
  // (öncelik: yönetici → finans → stok → doktor → hemşire → resepsiyon → satış →
  // eczane). Kullanıcının menüsünde tüm ekranları durur; istediğine geçer.
  // Böylece placeholder/boş ekran yok, regression yok.
  if (roles.includes(ROLES.YONETICI)) return <AdminOverviewPage />;
  if (roles.includes(ROLES.FINANS)) return <FinansOverview />;
  if (roles.includes(ROLES.STOK_SATINALMA)) return <StokOverview />;
  if (roles.includes(ROLES.DOKTOR)) return <DoctorOverview />;
  if (roles.includes(ROLES.HEMSIRE)) return <NurseOverview />;
  if (roles.includes(ROLES.RESEPSIYON)) return <ReceptionOverview />;
  if (roles.includes(ROLES.AMELIYAT_SATIS)) return <SalesOverview />;
  if (roles.includes(ROLES.ECZANE)) return <EczaneOverview />;

  // Güvenlik ağı: bilinen hiçbir klinik rol yoksa (teorik) iskelet göster.
  return <RoleOverviewPlaceholder />;
}
