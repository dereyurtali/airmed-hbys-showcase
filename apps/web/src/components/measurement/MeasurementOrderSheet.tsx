import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { MEASUREMENT_TYPES, type MeasurementType } from '../../lib/measurement.constants';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';

// S15c — Doktor "Ölçüm iste" sheet'i. İstenecek ölçüm tipleri + (varsa) ücretli
// ölçüm kalemleri seçilir. Ücretli kalem seçilirse encounter kasaya yönlenir.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  encounterId: string | null;
}

interface ServiceItemRow {
  id: string;
  name: string;
  defaultPrice: string;
}

export function MeasurementOrderSheet({ open, onOpenChange, patientId, encounterId }: Props) {
  const { t } = useTranslation('measurementOrder');
  const utils = trpc.useUtils();
  const [types, setTypes] = useState<MeasurementType[]>([]);
  const [serviceItemIds, setServiceItemIds] = useState<string[]>([]);

  const serviceItems = trpc.billing.listServiceItems.useQuery(
    { category: 'measurement' },
    { enabled: open },
  );

  const create = trpc.measurementOrder.create.useMutation({
    onSuccess: async () => {
      toast.success(t('order.success'));
      await utils.encounter.myWorklist.invalidate();
      setTypes([]);
      setServiceItemIds([]);
      onOpenChange(false);
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  const items = (serviceItems.data ?? []) as unknown as ServiceItemRow[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('order.title')}</DialogTitle>

        <div className="mt-4 space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('order.typesLabel')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {MEASUREMENT_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={types.includes(type)}
                    onChange={() => setTypes((p) => toggle(p, type))}
                  />
                  {type}
                </label>
              ))}
            </div>
          </fieldset>

          {items.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('order.billableHint')}</legend>
              <div className="space-y-1">
                {items.map((item) => (
                  <label key={item.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={serviceItemIds.includes(item.id)}
                      onChange={() => setServiceItemIds((p) => toggle(p, item.id))}
                    />
                    {item.name} · {item.defaultPrice}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <Button
            className="w-full"
            disabled={types.length === 0 || create.isPending}
            data-testid="measurement-order-submit"
            onClick={() =>
              create.mutate({ patientId, encounterId, requestedTypes: types, serviceItemIds })
            }
          >
            {t('order.submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
