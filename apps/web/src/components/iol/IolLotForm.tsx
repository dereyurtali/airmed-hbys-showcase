import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DateField } from '../ui/date-field';
import { Label } from '../ui/label';
import { trpc } from '../../lib/trpc';

export interface ExistingIolLot {
  id: string;
  modelId: string;
  lotNumber: string;
  power: number | string;
  expiresAt: string | Date;
  supplier: string | null;
  notes: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: string; // create mode için
  existing?: ExistingIolLot | null;
  onSaved: () => void;
}

function toDateInput(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function IolLotForm({ open, onOpenChange, modelId, existing, onSaved }: Props) {
  const { t } = useTranslation(['iol', 'common']);
  const utils = trpc.useUtils();
  const isEdit = existing !== null && existing !== undefined;

  const [lotNumber, setLotNumber] = useState('');
  const [power, setPower] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [initialQuantity, setInitialQuantity] = useState('0');
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (isEdit && existing) {
      setLotNumber(existing.lotNumber);
      setPower(String(existing.power));
      setExpiresAt(toDateInput(existing.expiresAt));
      setSupplier(existing.supplier ?? '');
      setNotes(existing.notes ?? '');
    } else {
      setLotNumber('');
      setPower('');
      const oneYear = new Date();
      oneYear.setFullYear(oneYear.getFullYear() + 1);
      setExpiresAt(toDateInput(oneYear));
      setInitialQuantity('0');
      setSupplier('');
      setNotes('');
    }
    setFormError(null);
  }, [open, isEdit, existing]);

  const handleError = (err: unknown) => {
    let msg = t('iol:errors.unknown');
    if (err instanceof TRPCClientError) {
      const raw = err.message;
      if (raw.includes('already exists')) {
        msg = t('iol:errors.lotDuplicate');
      } else if (raw.includes('Only yonetici')) {
        msg = t('iol:errors.forbidden');
      } else {
        msg = raw;
      }
    }
    setFormError(msg);
    toast.error(msg);
  };

  const create = trpc.iol.createLot.useMutation({
    onSuccess: async () => {
      toast.success(t('iol:toast.lotCreated'));
      await utils.iol.listLots.invalidate();
      await utils.iol.listModels.invalidate();
      // #407 — yeni lot stok seviyesini değiştirir → Genel Bakış rozeti tazelensin.
      void utils.dashboard.stockOverview.invalidate();
      onSaved();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const update = trpc.iol.updateLot.useMutation({
    onSuccess: async () => {
      toast.success(t('iol:toast.lotUpdated'));
      await utils.iol.listLots.invalidate();
      void utils.dashboard.stockOverview.invalidate();
      onSaved();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (isEdit && existing) {
      update.mutate({
        id: existing.id,
        data: {
          lotNumber: lotNumber.trim(),
          power: Number(power),
          expiresAt,
          supplier: supplier.trim() || null,
          notes: notes.trim() || null,
        },
      });
    } else {
      create.mutate({
        modelId,
        lotNumber: lotNumber.trim(),
        power: Number(power),
        expiresAt,
        initialQuantity: Number(initialQuantity),
        supplier: supplier.trim() || null,
        notes: notes.trim() || null,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>
          {isEdit ? t('iol:lotForm.editTitle') : t('iol:lotForm.createTitle')}
        </DialogTitle>
        <DialogDescription>{t('iol:lotForm.description')}</DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lot-number">{t('iol:lotForm.lotNumber')}</Label>
              <Input
                id="lot-number"
                value={lotNumber}
                onChange={(e) => setLotNumber(e.target.value)}
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lot-power">{t('iol:lotForm.power')}</Label>
              <Input
                id="lot-power"
                type="number"
                step="0.25"
                min={-30}
                max={50}
                value={power}
                onChange={(e) => setPower(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lot-expires">{t('iol:lotForm.expiresAt')}</Label>
              <DateField id="lot-expires" value={expiresAt} onChange={setExpiresAt} />
            </div>
            {!isEdit && (
              <div className="space-y-1.5">
                <Label htmlFor="lot-qty">{t('iol:lotForm.initialQty')}</Label>
                <Input
                  id="lot-qty"
                  type="number"
                  min={0}
                  step={1}
                  value={initialQuantity}
                  onChange={(e) => setInitialQuantity(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lot-supplier">{t('iol:lotForm.supplier')}</Label>
            <Input
              id="lot-supplier"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              maxLength={150}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lot-notes">{t('iol:lotForm.notes')}</Label>
            <textarea
              id="lot-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <Button type="submit" disabled={create.isPending || update.isPending}>
              {isEdit ? t('iol:lotForm.submitUpdate') : t('iol:lotForm.submitCreate')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
