import { getSidebarVariant } from '../../lib/sidebar-variant';
import { useAuth } from '../../providers/AuthProvider';
import { AdminSidebar } from './sidebar/admin-sidebar';
import { DoctorSidebar } from './sidebar/doctor-sidebar';
import { FinansSidebar } from './sidebar/finans-sidebar';
import { FullSidebar } from './sidebar/full-sidebar';
import { MeasurementNurseSidebar } from './sidebar/measurement-nurse-sidebar';
import { NurseSidebar } from './sidebar/nurse-sidebar';
import { PharmacySidebar } from './sidebar/pharmacy-sidebar';
import { ReceptionSidebar } from './sidebar/reception-sidebar';
import { SalesSidebar } from './sidebar/sales-sidebar';
import { StokSidebar } from './sidebar/stok-sidebar';
import type { SidebarProps } from './sidebar/shared';

// v0.4 (#541) — Sidebar artık yalnız bir DISPATCHER. Her rol/mod varyantının
// kendi dosyası var (./sidebar/*); böylece İP-7/8/9/10/23 farklı dosyalara
// dokunup çakışmaz (çakışmasızlık sözleşmesi §1). Varyant seçimi rol + moda
// göre (getSidebarVariant): kilitli "olcum" modu → ölçüm istasyonu kiosk'u;
// hemşire "genel/asistan" modu → hemşire sidebar'ı.
export function Sidebar({ onNavigate }: SidebarProps) {
  const { user } = useAuth();
  const variant = getSidebarVariant(user?.roles ?? [], user?.mode);

  switch (variant) {
    case 'doctor':
      return <DoctorSidebar onNavigate={onNavigate} />;
    case 'reception':
      return <ReceptionSidebar onNavigate={onNavigate} />;
    case 'nurse':
      return <NurseSidebar onNavigate={onNavigate} />;
    case 'measurement-nurse':
      return <MeasurementNurseSidebar onNavigate={onNavigate} />;
    case 'sales':
      return <SalesSidebar onNavigate={onNavigate} />;
    case 'pharmacy':
      return <PharmacySidebar onNavigate={onNavigate} />;
    case 'finans':
      return <FinansSidebar onNavigate={onNavigate} />;
    case 'stok':
      return <StokSidebar onNavigate={onNavigate} />;
    case 'admin':
      return <AdminSidebar onNavigate={onNavigate} />;
    default:
      return <FullSidebar onNavigate={onNavigate} />;
  }
}
