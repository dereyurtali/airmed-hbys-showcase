import { useTranslation } from 'react-i18next';
import { BackBar } from '../components/layout/BackBar';
import { PageHeader } from '../components/layout/PageHeader';
import { MovementsTable, type MovementRow } from '../components/inventory/MovementsTable';
import type { BadgeProps } from '../components/ui/badge';
import { trpc } from '../lib/trpc';

// v0.4.1 (#691) — Klinik stok hareketleri (Mal Kabul / Stok Hareketleri). Tenant-
// geneli son lens (IOL) giriş/çıkış/düzeltme kayıtları; Stok & Satın Alma rolünün
// landing/ana hareket ekranı. Tablo iskeleti #906'da ortak <MovementsTable>'a taşındı.

const TYPE_VARIANT: Record<string, BadgeProps['variant']> = {
  receive: 'success',
  consume: 'info',
  adjust: 'warning',
  return: 'info',
  expire: 'critical',
};

/** Klinik stok hareketleri — tenant-geneli son lens stok hareketleri tablosu. */
export function StockMovementsPage() {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = trpc.iol.recentMovements.useQuery({ limit: 100 });

  const rows: MovementRow[] | undefined = data?.map((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    type: m.type,
    quantity: m.quantity,
    itemPrimary: m.lot?.model ? `${m.lot.model.brand} ${m.lot.model.model}` : '—',
    itemSecondary: m.lot ? `${m.lot.lotNumber} · ${Number(m.lot.power)} D` : null,
    userName: m.createdBy?.name ?? null,
    notes: m.notes ?? null,
  }));

  return (
    <div className="space-y-4">
      <BackBar />
      <PageHeader
        title={t('stockMovements.title', { defaultValue: 'Mal Kabul / Stok Hareketleri' })}
        description={t('stockMovements.description', {
          defaultValue: 'Son lens stok giriş, çıkış ve düzeltme kayıtları.',
        })}
      />
      <MovementsTable
        rows={rows}
        isLoading={isLoading}
        isError={isError}
        i18nPrefix="stockMovements"
        typeVariant={TYPE_VARIANT}
      />
    </div>
  );
}
