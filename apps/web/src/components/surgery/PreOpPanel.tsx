import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Loader2 } from 'lucide-react';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DateTimeField } from '../ui/date-field';
import { Label } from '../ui/label';
import { trpc } from '../../lib/trpc';

interface Props {
  surgeryId: string;
  canEdit: boolean;
  isAdmin: boolean;
}

const REQUIRED_KEYS = [
  'fasting_8h',
  'blood_sugar',
  'blood_pressure',
  'pupil_dilation',
  'antibiotic_prophylaxis',
  'consent_signed',
  // S15-PR15 — Anestezi konsültasyonu zorunlu pre-op item
  'anesthesia_consult_completed',
  'surgeon_ready',
] as const;
const OPTIONAL_KEYS = ['lens_reserved'] as const;
const ALL_KEYS = [...REQUIRED_KEYS, ...OPTIONAL_KEYS] as const;

type ChecklistKey = (typeof ALL_KEYS)[number];

interface ChecklistItem {
  key: string;
  completed: boolean;
  completedById?: string | null;
  completedAt?: string | null;
  notes?: string | null;
}

interface VitalSigns {
  bloodSugar?: number;
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  weightKg?: number;
  temperatureC?: number;
  oxygenSaturation?: number;
}

interface PreOpRow {
  id: string;
  surgeryId: string;
  vitalSigns: VitalSigns;
  dilatationAt: string | null;
  anesthesiaNotes: string | null;
  lensIolLotId: string | null;
  lensReservedAt: string | null;
  readyForSurgery: boolean;
  readyAt: string | null;
  readyById: string | null;
  checklistItems: ChecklistItem[];
  lensIolLot: {
    id: string;
    lotNumber: string;
    quantity: number;
    model: { brand: string; model: string };
  } | null;
}

function toDateTimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PreOpPanel({ surgeryId, canEdit, isAdmin }: Props) {
  const { t } = useTranslation(['preOp', 'common']);
  const utils = trpc.useUtils();

  const query = trpc.preOp.getBySurgery.useQuery({ surgeryId });
  const preOp = query.data as PreOpRow | null | undefined;

  const requiredCount = useMemo(() => {
    if (!preOp) return REQUIRED_KEYS.length;
    return REQUIRED_KEYS.length + (preOp.lensIolLotId ? 1 : 0);
  }, [preOp]);

  const doneCount = useMemo(() => {
    if (!preOp) return 0;
    const byKey = new Map(preOp.checklistItems.map((i) => [i.key, i]));
    let count = 0;
    for (const k of REQUIRED_KEYS) {
      if (byKey.get(k)?.completed) count++;
    }
    if (preOp.lensIolLotId && byKey.get('lens_reserved')?.completed) count++;
    return count;
  }, [preOp]);

  const [open, setOpen] = useState(false);

  const handleError = (err: unknown) => {
    toast.error(err instanceof TRPCClientError ? err.message : t('preOp:errors.unknown'));
  };
  const invalidateGet = () => utils.preOp.getBySurgery.invalidate({ surgeryId });

  const create = trpc.preOp.create.useMutation({
    onSuccess: () => {
      toast.success(t('preOp:toast.created'));
      void invalidateGet();
    },
    onError: handleError,
  });

  const markReady = trpc.preOp.markReady.useMutation({
    onSuccess: async () => {
      toast.success(t('preOp:toast.ready'));
      await utils.preOp.getBySurgery.invalidate({ surgeryId });
    },
    onError: (err) =>
      toast.error(err instanceof TRPCClientError ? err.message : t('preOp:errors.unknown')),
  });
  const unmarkReady = trpc.preOp.unmarkReady.useMutation({
    onSuccess: async () => {
      toast.success(t('preOp:toast.unmarked'));
      await utils.preOp.getBySurgery.invalidate({ surgeryId });
    },
    onError: (err) =>
      toast.error(err instanceof TRPCClientError ? err.message : t('preOp:errors.unknown')),
  });

  if (query.isLoading) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{t('common:loading')}</span>
      </div>
    );
  }

  if (!preOp) {
    if (!canEdit) return null;
    return (
      <div className="mt-2 flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <ClipboardList className="h-3.5 w-3.5" />
          {t('preOp:section.title')}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs"
          disabled={create.isPending}
          onClick={() => create.mutate({ surgeryId })}
          data-testid="preop-open"
        >
          {t('preOp:section.openButton')}
        </Button>
      </div>
    );
  }

  const ready = preOp.readyForSurgery;
  const allRequiredDone = doneCount >= requiredCount;

  return (
    <div
      className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
        ready ? 'border-success-border bg-success-bg text-success-foreground' : 'bg-muted/20'
      }`}
      data-testid="preop-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium">
          {ready ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <ClipboardList className="h-3.5 w-3.5" />
          )}
          {ready ? t('preOp:section.ready') : t('preOp:section.notReady')}
          <span className="ml-2 text-muted-foreground">
            {t('preOp:section.progress', { done: doneCount, total: requiredCount })}
          </span>
        </span>
        <div className="flex items-center gap-1">
          {canEdit && !ready && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={() => setOpen(true)}
              data-testid="preop-edit"
            >
              {t('preOp:section.editButton')}
            </Button>
          )}
          {canEdit && !ready && allRequiredDone && (
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={markReady.isPending}
              onClick={() => markReady.mutate({ surgeryId })}
              data-testid="preop-mark-ready"
            >
              {t('preOp:section.markReady')}
            </Button>
          )}
          {isAdmin && ready && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              disabled={unmarkReady.isPending}
              onClick={() => unmarkReady.mutate({ surgeryId })}
              data-testid="preop-unmark-ready"
            >
              {t('preOp:section.unmarkReady')}
            </Button>
          )}
        </div>
      </div>

      {open && (
        <PreOpDialog open={open} onOpenChange={setOpen} surgeryId={surgeryId} preOp={preOp} />
      )}
    </div>
  );
}

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surgeryId: string;
  preOp: PreOpRow;
}

function PreOpDialog({ open, onOpenChange, surgeryId, preOp }: DialogProps) {
  const { t } = useTranslation(['preOp', 'common']);
  const utils = trpc.useUtils();

  const [vitals, setVitals] = useState<VitalSigns>(() => preOp.vitalSigns ?? {});
  const [dilatationLocal, setDilatationLocal] = useState<string>(() =>
    toDateTimeLocal(preOp.dilatationAt),
  );
  const [notes, setNotes] = useState<string>(() => preOp.anesthesiaNotes ?? '');
  const [lensLotId, setLensLotId] = useState<string>(() => preOp.lensIolLotId ?? '');

  useEffect(() => {
    setVitals(preOp.vitalSigns ?? {});
    setDilatationLocal(toDateTimeLocal(preOp.dilatationAt));
    setNotes(preOp.anesthesiaNotes ?? '');
    setLensLotId(preOp.lensIolLotId ?? '');
  }, [preOp.id, preOp.vitalSigns, preOp.dilatationAt, preOp.anesthesiaNotes, preOp.lensIolLotId]);

  const lotsQuery = trpc.iol.listLots.useQuery({ includeEmpty: false });
  const lots =
    (lotsQuery.data as
      | Array<{
          id: string;
          lotNumber: string;
          power: string;
          quantity: number;
          model: { brand: string; model: string };
        }>
      | undefined) ?? [];

  const update = trpc.preOp.update.useMutation({
    onSuccess: async () => {
      toast.success(t('preOp:toast.updated'));
      await utils.preOp.getBySurgery.invalidate({ surgeryId });
    },
    onError: (err) =>
      toast.error(err instanceof TRPCClientError ? err.message : t('preOp:errors.unknown')),
  });

  const patchItem = trpc.preOp.patchChecklistItem.useMutation({
    onSuccess: async () => {
      await utils.preOp.getBySurgery.invalidate({ surgeryId });
    },
    onError: (err) =>
      toast.error(err instanceof TRPCClientError ? err.message : t('preOp:errors.unknown')),
  });

  const numberOrUndef = (v: string): number | undefined => {
    if (v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const handleSave = async () => {
    await update.mutateAsync({
      surgeryId,
      vitalSigns: vitals,
      dilatationAt: dilatationLocal ? new Date(dilatationLocal).toISOString() : null,
      anesthesiaNotes: notes || null,
      lensIolLotId: lensLotId || null,
    });
    onOpenChange(false);
  };

  const byKey = new Map(preOp.checklistItems.map((i) => [i.key, i]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>{t('preOp:dialog.title')}</DialogTitle>
        <DialogDescription>{t('preOp:dialog.description')}</DialogDescription>

        <section className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold">{t('preOp:dialog.vitalsTitle')}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="preop-systolic">{t('preOp:dialog.systolic')}</Label>
              <Input
                id="preop-systolic"
                type="number"
                value={vitals.systolic ?? ''}
                onChange={(e) => setVitals({ ...vitals, systolic: numberOrUndef(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="preop-diastolic">{t('preOp:dialog.diastolic')}</Label>
              <Input
                id="preop-diastolic"
                type="number"
                value={vitals.diastolic ?? ''}
                onChange={(e) => setVitals({ ...vitals, diastolic: numberOrUndef(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="preop-pulse">{t('preOp:dialog.pulse')}</Label>
              <Input
                id="preop-pulse"
                type="number"
                value={vitals.pulse ?? ''}
                onChange={(e) => setVitals({ ...vitals, pulse: numberOrUndef(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="preop-blood-sugar">{t('preOp:dialog.bloodSugar')}</Label>
              <Input
                id="preop-blood-sugar"
                type="number"
                value={vitals.bloodSugar ?? ''}
                onChange={(e) =>
                  setVitals({ ...vitals, bloodSugar: numberOrUndef(e.target.value) })
                }
              />
            </div>
            <div>
              <Label htmlFor="preop-temp">{t('preOp:dialog.temperatureC')}</Label>
              <Input
                id="preop-temp"
                type="number"
                step="0.1"
                value={vitals.temperatureC ?? ''}
                onChange={(e) =>
                  setVitals({ ...vitals, temperatureC: numberOrUndef(e.target.value) })
                }
              />
            </div>
            <div>
              <Label htmlFor="preop-spo2">{t('preOp:dialog.oxygenSaturation')}</Label>
              <Input
                id="preop-spo2"
                type="number"
                value={vitals.oxygenSaturation ?? ''}
                onChange={(e) =>
                  setVitals({ ...vitals, oxygenSaturation: numberOrUndef(e.target.value) })
                }
              />
            </div>
          </div>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="preop-dilatation">{t('preOp:dialog.dilatationAt')}</Label>
            <DateTimeField
              id="preop-dilatation"
              value={dilatationLocal}
              onChange={setDilatationLocal}
            />
          </div>
          <div>
            <Label htmlFor="preop-lens">{t('preOp:dialog.lensTitle')}</Label>
            <select
              id="preop-lens"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              value={lensLotId}
              onChange={(e) => setLensLotId(e.target.value)}
            >
              <option value="">{t('preOp:dialog.lensNone')}</option>
              {lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.model.brand} {lot.model.model} — {lot.lotNumber} ({lot.power}D, ×
                  {lot.quantity})
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="mt-4">
          <Label htmlFor="preop-notes">{t('preOp:dialog.anesthesiaNotes')}</Label>
          <textarea
            id="preop-notes"
            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </section>

        <section className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold">{t('preOp:dialog.checklistTitle')}</h3>
          <ul className="space-y-1">
            {ALL_KEYS.map((key) => {
              const item = byKey.get(key);
              const checked = !!item?.completed;
              return (
                <li key={key} className="flex items-center gap-2 text-sm">
                  <input
                    id={`preop-cl-${key}`}
                    type="checkbox"
                    checked={checked}
                    disabled={patchItem.isPending}
                    onChange={(e) =>
                      patchItem.mutate({
                        surgeryId,
                        key,
                        completed: e.target.checked,
                      })
                    }
                    data-testid={`preop-cl-${key}`}
                  />
                  <Label htmlFor={`preop-cl-${key}`} className="cursor-pointer">
                    {t(`preOp:checklist.${key as ChecklistKey}`)}
                  </Label>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('preOp:dialog.close')}
          </Button>
          <Button onClick={handleSave} disabled={update.isPending}>
            {update.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {t('preOp:dialog.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
