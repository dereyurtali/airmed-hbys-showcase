import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { trpc } from '../../lib/trpc';

type MovementType = 'receive' | 'adjust' | 'return' | 'expire';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lotId: string;
  currentQuantity: number;
}

export function IolMovementDialog({ open, onOpenChange, lotId, currentQuantity }: Props) {
  const { t } = useTranslation(['iol', 'common']);
  const utils = trpc.useUtils();

  const [type, setType] = useState<MovementType>('receive');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType('receive');
    setQuantity('1');
    setNotes('');
    setFormError(null);
  }, [open]);

  const handleError = (err: unknown) => {
    let msg = t('iol:errors.unknown');
    if (err instanceof TRPCClientError) {
      const raw = err.message;
      if (raw.includes('negative stock')) {
        msg = t('iol:errors.negativeStock');
      } else if (raw.includes('Only yonetici')) {
        msg = t('iol:errors.forbidden');
      } else {
        msg = raw;
      }
    }
    setFormError(msg);
    toast.error(msg);
  };

  const create = trpc.iol.createMovement.useMutation({
    onSuccess: async () => {
      toast.success(t('iol:toast.movementCreated'));
      await utils.iol.listLots.invalidate();
      await utils.iol.listMovements.invalidate({ id: lotId });
      // #407 — receive/adjust/expire stok seviyesini değiştirir → Genel Bakış rozeti.
      void utils.dashboard.stockOverview.invalidate();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const q = Number(quantity);
    if (!Number.isFinite(q) || q === 0) {
      setFormError(t('iol:errors.qtyNonZero'));
      return;
    }
    create.mutate({
      lotId,
      type,
      quantity: q,
      notes: notes.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>{t('iol:movementForm.title')}</DialogTitle>
        <DialogDescription>
          {t('iol:movementForm.description', { current: currentQuantity })}
        </DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t('iol:movementForm.type')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {(['receive', 'adjust', 'return', 'expire'] as MovementType[]).map((mt) => (
                <label
                  key={mt}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <input
                    type="radio"
                    name="movement-type"
                    checked={type === mt}
                    onChange={() => setType(mt)}
                  />
                  {t(`iol:movementType.${mt}`)}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="mv-qty">{t('iol:movementForm.quantity')}</Label>
            <Input
              id="mv-qty"
              type="number"
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              {type === 'adjust'
                ? t('iol:movementForm.adjustHint')
                : t('iol:movementForm.positiveHint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mv-notes">{t('iol:movementForm.notes')}</Label>
            <textarea
              id="mv-notes"
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
            <Button type="submit" disabled={create.isPending}>
              {t('iol:movementForm.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
