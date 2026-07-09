import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { trpc } from '../../lib/trpc';

export const IOL_LENS_TYPES = ['monofocal', 'trifocal', 'edof', 'toric'] as const;
type LensType = (typeof IOL_LENS_TYPES)[number];

export interface ExistingIolModel {
  id: string;
  brand: string;
  model: string;
  description: string | null;
  isActive: boolean;
  lensType?: string;
  minQty?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: ExistingIolModel | null;
  onSaved: () => void;
}

export function IolModelForm({ open, onOpenChange, existing, onSaved }: Props) {
  const { t } = useTranslation(['iol', 'common']);
  const utils = trpc.useUtils();
  const isEdit = existing !== null && existing !== undefined;

  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [lensType, setLensType] = useState<LensType>('monofocal');
  const [minQty, setMinQty] = useState('0');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (isEdit && existing) {
      setBrand(existing.brand);
      setModel(existing.model);
      setDescription(existing.description ?? '');
      setIsActive(existing.isActive);
      setLensType((existing.lensType as LensType) ?? 'monofocal');
      setMinQty(String(existing.minQty ?? 0));
    } else {
      setBrand('');
      setModel('');
      setDescription('');
      setIsActive(true);
      setLensType('monofocal');
      setMinQty('0');
    }
    setFormError(null);
  }, [open, isEdit, existing]);

  const handleError = (err: unknown) => {
    let msg = t('iol:errors.unknown');
    if (err instanceof TRPCClientError) {
      const raw = err.message;
      if (raw.includes('already exists')) {
        msg = t('iol:errors.modelDuplicate');
      } else if (raw.includes('Only yonetici')) {
        msg = t('iol:errors.forbidden');
      } else {
        msg = raw;
      }
    }
    setFormError(msg);
    toast.error(msg);
  };

  const create = trpc.iol.createModel.useMutation({
    onSuccess: async () => {
      toast.success(t('iol:toast.modelCreated'));
      await utils.iol.listModels.invalidate();
      // #407 — minQty/aktiflik low-stock'u etkiler → Genel Bakış rozeti tazelensin.
      void utils.dashboard.stockOverview.invalidate();
      onSaved();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const update = trpc.iol.updateModel.useMutation({
    onSuccess: async () => {
      toast.success(t('iol:toast.modelUpdated'));
      await utils.iol.listModels.invalidate();
      void utils.dashboard.stockOverview.invalidate();
      onSaved();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const lensFields = { lensType, minQty: parseInt(minQty, 10) || 0 };
    if (isEdit && existing) {
      update.mutate({
        id: existing.id,
        data: {
          brand: brand.trim(),
          model: model.trim(),
          description: description.trim() || null,
          isActive,
          ...lensFields,
        },
      });
    } else {
      create.mutate({
        brand: brand.trim(),
        model: model.trim(),
        description: description.trim() || null,
        ...lensFields,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>
          {isEdit ? t('iol:modelForm.editTitle') : t('iol:modelForm.createTitle')}
        </DialogTitle>
        <DialogDescription>{t('iol:modelForm.description')}</DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="iol-brand">{t('iol:modelForm.brand')}</Label>
            <Input
              id="iol-brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              maxLength={100}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="iol-model">{t('iol:modelForm.model')}</Label>
            <Input
              id="iol-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              maxLength={100}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="iol-lenstype">
                {t('iol:modelForm.lensType', { defaultValue: 'Lens tipi' })}
              </Label>
              <select
                id="iol-lenstype"
                value={lensType}
                onChange={(e) => setLensType(e.target.value as LensType)}
                className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {IOL_LENS_TYPES.map((lt) => (
                  <option key={lt} value={lt}>
                    {t(`common:adminOverview.lensType.${lt}`, { defaultValue: lt })}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iol-minqty">
                {t('iol:modelForm.minQty', { defaultValue: 'Min stok' })}
              </Label>
              <Input
                id="iol-minqty"
                type="number"
                min={0}
                value={minQty}
                onChange={(e) => setMinQty(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="iol-desc">{t('iol:modelForm.descriptionField')}</Label>
            <textarea
              id="iol-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {isEdit && (
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              {t('iol:modelForm.isActive')}
            </label>
          )}

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
              {isEdit ? t('iol:modelForm.submitUpdate') : t('iol:modelForm.submitCreate')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
