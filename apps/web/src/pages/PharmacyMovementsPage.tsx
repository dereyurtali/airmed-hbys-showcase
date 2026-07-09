import { useTranslation } from 'react-i18next';
import { BackBar } from '../components/layout/BackBar';
import { PageHeader } from '../components/layout/PageHeader';
import { MovementsTable, type MovementRow } from '../components/inventory/MovementsTable';
import type { BadgeProps } from '../components/ui/badge';
import { trpc } from '../lib/trpc';

// v0.4.1 (#692) — Eczane Mal Kabul / Stok Hareketleri. Tenant-geneli son eczane
// stok hareketleri (intake=mal kabul / sale / return / adjustment / disposal /
// expire). Klinik IOL hareketlerinden ayrı eczane stok trail'i. Tablo iskeleti
// #906'da ortak <MovementsTable>'a taşındı. (Route /pharmacy/purchase + izin
// page:pharmacyIntake korunur; dosya adı #906'da hareket-trail'e uyacak şekilde
// PharmacyPurchasePage'den PharmacyMovementsPage'e alındı.)

const TYPE_VARIANT: Record<string, BadgeProps['variant']> = {
  intake: 'success',
  sale: 'info',
  return: 'neutral',
  adjustment: 'warning',
  disposal: 'critical',
  expire: 'critical',
};

/** Eczane Mal Kabul / Stok Hareketleri — tenant-geneli son eczane stok hareketleri. */
export function PharmacyMovementsPage() {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = trpc.pharmacyRetail.recentMovements.useQuery({ limit: 100 });

  const rows: MovementRow[] | undefined = data?.map((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    type: m.type,
    quantity: m.quantityDelta,
    itemPrimary: m.product?.name ?? '—',
    itemSecondary: [m.product?.code, m.batch?.lotNumber].filter(Boolean).join(' · ') || null,
    userName: m.createdBy?.name ?? null,
    notes: m.notes ?? null,
  }));

  return (
    <div className="space-y-4">
      <BackBar />
      <PageHeader
        title={t('pharmacyMovements.title', { defaultValue: 'Mal Kabul / Stok Hareketleri' })}
        description={t('pharmacyMovements.description', {
          defaultValue: 'Son eczane stok giriş (mal kabul), satış, iade ve düzeltme kayıtları.',
        })}
      />
      <MovementsTable
        rows={rows}
        isLoading={isLoading}
        isError={isError}
        i18nPrefix="pharmacyMovements"
        typeVariant={TYPE_VARIANT}
      />
    </div>
  );
}
