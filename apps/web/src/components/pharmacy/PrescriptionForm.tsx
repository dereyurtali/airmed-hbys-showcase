import { useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  PRESCRIPTION_TYPES,
  type DrugItem,
  type EyewearItem,
  type PrescriptionType,
} from '../../lib/pharmacy.constants';
import { trpc } from '../../lib/trpc';
import { DrugInteractionWarnings } from './DrugInteractionWarnings';

interface SupplierOption {
  id: string;
  name: string;
  category: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  suppliers: SupplierOption[];
  onSaved: () => void;
}

export function PrescriptionForm({ open, onOpenChange, patientId, suppliers, onSaved }: Props) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const utils = trpc.useUtils();
  const [type, setType] = useState<PrescriptionType>('drug');
  const [supplierId, setSupplierId] = useState<string>('');
  const [drugItems, setDrugItems] = useState<DrugItem[]>([{ name: '' }]);
  const [eyewearItems, setEyewearItems] = useState<EyewearItem[]>([{ eye: 'OD' }, { eye: 'OS' }]);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType('drug');
    setSupplierId('');
    setDrugItems([{ name: '' }]);
    setEyewearItems([{ eye: 'OD' }, { eye: 'OS' }]);
    setNotes('');
    setFormError(null);
  }, [open]);

  const filteredSuppliers = suppliers.filter(
    (s) =>
      s.category === 'other' ||
      (type === 'drug' && s.category === 'pharmacy') ||
      (type === 'eyewear' && s.category === 'optic'),
  );

  const handleError = (err: unknown) => {
    let msg = t('pharmacy:errors.unknown');
    if (err instanceof TRPCClientError) {
      const raw = err.message;
      if (raw.includes('does not match prescription type')) {
        msg = t('pharmacy:errors.supplierCategoryMismatch');
      } else if (raw.includes('not found or inactive')) {
        msg = t('pharmacy:errors.supplierInactive');
      } else {
        msg = raw;
      }
    }
    setFormError(msg);
    toast.error(msg);
  };

  const create = trpc.pharmacy.createPrescription.useMutation({
    onSuccess: async () => {
      toast.success(t('pharmacy:toast.created'));
      await utils.pharmacy.listPrescriptions.invalidate({ patientId });
      onSaved();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const items =
      type === 'drug'
        ? drugItems.filter((i) => i.name.trim())
        : eyewearItems.filter((i) => i.sphere || i.cylinder || i.axis || i.add || i.pd);
    if (items.length === 0) {
      setFormError(t('pharmacy:errors.noItems'));
      return;
    }
    create.mutate({
      patientId,
      type,
      supplierId: supplierId || null,
      items: items as unknown as Record<string, unknown>[],
      notes: notes.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>{t('pharmacy:rxForm.title')}</DialogTitle>
        <DialogDescription>{t('pharmacy:rxForm.description')}</DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t('pharmacy:rxForm.type')}</legend>
            <div className="flex gap-3">
              {PRESCRIPTION_TYPES.map((tt) => (
                <label key={tt} className="inline-flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="rx-type"
                    checked={type === tt}
                    onChange={() => setType(tt)}
                  />
                  {t(`pharmacy:type.${tt}`)}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="rx-supplier">{t('pharmacy:rxForm.supplier')}</Label>
            <select
              id="rx-supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">{t('pharmacy:rxForm.noSupplier')}</option>
              {filteredSuppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {t(`pharmacy:supplierCategory.${s.category}`)}
                </option>
              ))}
            </select>
          </div>

          {type === 'drug' && <DrugItems items={drugItems} onChange={setDrugItems} />}
          {type === 'eyewear' && <EyewearItems items={eyewearItems} onChange={setEyewearItems} />}

          {/* S15-PR4 — İlaç etkileşim uyarıları. Reçete tipi drug iken hasta
              allerji/antikoagülan + drug item adlarını cross-check eder. */}
          {type === 'drug' && (
            <DrugInteractionWarnings patientId={patientId} drugItems={drugItems} />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rx-notes">{t('pharmacy:rxForm.notes')}</Label>
            <textarea
              id="rx-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {t('pharmacy:rxForm.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DrugItems({
  items,
  onChange,
}: {
  items: DrugItem[];
  onChange: (next: DrugItem[]) => void;
}) {
  const { t } = useTranslation('pharmacy');
  return (
    <fieldset className="space-y-2 rounded-md border bg-muted/20 p-3">
      <legend className="text-sm font-medium">{t('rxForm.drugItems')}</legend>
      {items.map((it, idx) => (
        <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          <Input
            placeholder={t('rxForm.drugName')}
            value={it.name}
            onChange={(e) =>
              onChange(items.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
            }
            className="sm:col-span-2"
            maxLength={120}
          />
          <Input
            placeholder={t('rxForm.dose')}
            value={it.dose ?? ''}
            onChange={(e) =>
              onChange(items.map((x, i) => (i === idx ? { ...x, dose: e.target.value } : x)))
            }
            maxLength={50}
          />
          <Input
            placeholder={t('rxForm.frequency')}
            value={it.frequency ?? ''}
            onChange={(e) =>
              onChange(items.map((x, i) => (i === idx ? { ...x, frequency: e.target.value } : x)))
            }
            maxLength={50}
          />
          <div className="flex gap-1">
            <Input
              placeholder={t('rxForm.duration')}
              value={it.duration ?? ''}
              onChange={(e) =>
                onChange(items.map((x, i) => (i === idx ? { ...x, duration: e.target.value } : x)))
              }
              maxLength={50}
            />
            {items.length > 1 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange(items.filter((_, i) => i !== idx))}
                aria-label="remove"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange([...items, { name: '' }])}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        {t('rxForm.addItem')}
      </Button>
    </fieldset>
  );
}

function EyewearItems({
  items,
  onChange,
}: {
  items: EyewearItem[];
  onChange: (next: EyewearItem[]) => void;
}) {
  const { t } = useTranslation('pharmacy');
  return (
    <fieldset className="space-y-2 rounded-md border bg-muted/20 p-3">
      <legend className="text-sm font-medium">{t('rxForm.eyewearItems')}</legend>
      <div className="grid grid-cols-1 gap-2 text-sm">
        <div className="grid grid-cols-6 gap-2 text-xs font-medium text-muted-foreground">
          <span>{t('rxForm.eye')}</span>
          <span>{t('rxForm.sphere')}</span>
          <span>{t('rxForm.cylinder')}</span>
          <span>{t('rxForm.axis')}</span>
          <span>{t('rxForm.add')}</span>
          <span>{t('rxForm.pd')}</span>
        </div>
        {items.map((it, idx) => (
          <div key={idx} className="grid grid-cols-6 gap-2">
            <span className="flex items-center font-medium">{it.eye}</span>
            <Input
              value={(it.sphere ?? '') as string}
              onChange={(e) =>
                onChange(items.map((x, i) => (i === idx ? { ...x, sphere: e.target.value } : x)))
              }
              placeholder="±0.00"
            />
            <Input
              value={(it.cylinder ?? '') as string}
              onChange={(e) =>
                onChange(items.map((x, i) => (i === idx ? { ...x, cylinder: e.target.value } : x)))
              }
              placeholder="±0.00"
            />
            <Input
              value={(it.axis ?? '') as string}
              onChange={(e) =>
                onChange(items.map((x, i) => (i === idx ? { ...x, axis: e.target.value } : x)))
              }
              placeholder="0-180"
            />
            <Input
              value={(it.add ?? '') as string}
              onChange={(e) =>
                onChange(items.map((x, i) => (i === idx ? { ...x, add: e.target.value } : x)))
              }
              placeholder="+0.00"
            />
            <Input
              value={(it.pd ?? '') as string}
              onChange={(e) =>
                onChange(items.map((x, i) => (i === idx ? { ...x, pd: e.target.value } : x)))
              }
              placeholder="mm"
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}
