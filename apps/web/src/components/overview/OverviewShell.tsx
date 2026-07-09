import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../layout/PageHeader';

/**
 * Genel Bakış sayfa kabuğu — her rol/mod/nitelik varyantının landing iskeleti.
 * PageHeader (default başlık "Genel Bakış") + opsiyonel scope/aksiyon slot'u + içerik.
 * Rol issue'ları (R1-R9) StatCard grid + WidgetShell'leri children olarak doldurur.
 */

interface OverviewShellProps {
  title?: string;
  description?: string;
  /** Sağ üst — scope çipi (Bugün) / son-güncelleme / birincil CTA. */
  actions?: ReactNode;
  children?: ReactNode;
}

export function OverviewShell({ title, description, actions, children }: OverviewShellProps) {
  const { t } = useTranslation('common');
  return (
    <div className="space-y-6">
      <PageHeader title={title ?? t('nav.overview')} description={description} actions={actions} />
      {children}
    </div>
  );
}
