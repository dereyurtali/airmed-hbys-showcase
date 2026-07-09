import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';

// R8 (#730) — Forecast'tan seçilen kritik lotlardan taslak PO. IOL lotları PO
// referans modelinde (consumable/pharmacy_product) yok → serbest-metin kalem
// (itemName=model+power, qty=eksik). Tedarikçi seçilir; fiyat procurement'ta
// (Karar 8) sonra PO ekranında girilir. status=draft (create).

export type ForecastDraftItem = { lotId: string; label: string; qty: number };

type Supplier = { id: string; name: string };

export function ForecastPoDraftDialog({
  items,
  onClose,
  onCreated,
}: {
  items: ForecastDraftItem[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation(['iol', 'common']);
  const [supplierId, setSupplierId] = useState('');

  const suppliersQuery = trpc.pharmacy.listSuppliers.useQuery({ includeInactive: false });
  const suppliers = (suppliersQuery.data ?? []) as Supplier[];

  const create = trpc.purchaseOrder.create.useMutation({
    onSuccess: () => {
      toast.success(t('iol:forecast.poDraftCreated', { defaultValue: 'PO taslağı oluşturuldu' }));
      onCreated();
      onClose();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>
          {t('iol:forecast.poDraftTitle', { defaultValue: 'Seçilenlerden PO Taslağı' })}
        </DialogTitle>
        <DialogDescription>
          {t('iol:forecast.poDraftHint', {
            defaultValue:
              'Seçili kritik lotlardan taslak satın alma siparişi. Birim fiyatı PO ekranında girersiniz.',
          })}
        </DialogDescription>

        <label className="mt-3 block text-sm">
          <span className="mb-1 block font-medium">
            {t('iol:forecast.supplier', { defaultValue: 'Tedarikçi' })}
          </span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
            data-testid="forecast-po-supplier"
          >
            <option value="">
              {t('iol:forecast.supplierSelect', { defaultValue: 'Seçiniz…' })}
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <ul className="mt-3 max-h-48 space-y-1 overflow-auto rounded-lg border bg-muted/20 p-2 text-sm">
          {items.map((it) => (
            <li key={it.lotId} className="flex justify-between">
              <span className="truncate">{it.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">×{it.qty}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            disabled={!supplierId || create.isPending || items.length === 0}
            onClick={() =>
              create.mutate({
                supplierId,
                domain: 'clinic',
                currency: 'TJS',
                items: items.map((it) => ({
                  itemName: it.label,
                  quantity: it.qty,
                  unitPrice: 0,
                })),
              })
            }
            data-testid="forecast-po-create"
          >
            {t('iol:forecast.poDraftCreate', { defaultValue: 'Taslak Oluştur' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
