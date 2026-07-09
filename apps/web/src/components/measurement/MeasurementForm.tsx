import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DateTimeField } from '../ui/date-field';
import { Label } from '../ui/label';
import { EyeSideField } from '../clinical';
import {
  SUPPORTED_FORM_TYPES,
  TYPE_FIELDS,
  type MeasurementValues,
  type SupportedFormType,
} from '../../lib/measurement.constants';
import { trpc } from '../../lib/trpc';

type Mode = 'create' | 'edit';

// S15-PR6 — Göz tarafı zorunlu (yanlış göz cerrahisi önleme).
export type EyeSide = 'od' | 'os' | 'ou';
export const EYE_SIDES: readonly EyeSide[] = ['od', 'os', 'ou'] as const;

export interface ExistingMeasurement {
  id: string;
  type: SupportedFormType;
  eyeSide: EyeSide;
  measuredAt: Date;
  values: MeasurementValues;
  notes: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: Mode;
  patientId: string;
  existing?: ExistingMeasurement | null;
  onSaved: () => void;
}

function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MeasurementForm({
  open,
  onOpenChange,
  mode = 'create',
  patientId,
  existing,
  onSaved,
}: Props) {
  const { t } = useTranslation(['measurement', 'common']);
  const utils = trpc.useUtils();
  const isEdit = mode === 'edit';

  const [type, setType] = useState<SupportedFormType>('intraocular_pressure');
  const [eyeSide, setEyeSide] = useState<EyeSide>('ou');
  const [measuredAt, setMeasuredAt] = useState(toDateTimeLocal(new Date()));
  const [values, setValues] = useState<MeasurementValues>({});
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const fields = useMemo(() => TYPE_FIELDS[type], [type]);

  useEffect(() => {
    if (!open) return;
    if (isEdit && existing) {
      setType(existing.type);
      setEyeSide(existing.eyeSide ?? 'ou');
      setMeasuredAt(toDateTimeLocal(existing.measuredAt));
      setValues(existing.values ?? {});
      setNotes(existing.notes ?? '');
    } else {
      setType('intraocular_pressure');
      setEyeSide('ou');
      setMeasuredAt(toDateTimeLocal(new Date()));
      setValues({});
      setNotes('');
    }
    setFormError(null);
  }, [open, isEdit, existing]);

  const handleError = (err: unknown) => {
    let msg = t('measurement:errors.unknown');
    if (err instanceof TRPCClientError) {
      const raw = err.message;
      if (raw.includes('Same-day edit window expired')) {
        msg = t('measurement:errors.sameDayExpired');
      } else if (raw.includes('Only the recording user or yonetici')) {
        msg = t('measurement:errors.onlyOwnerOrAdmin');
      } else if (raw.includes('Only yonetici can edit system-recorded')) {
        msg = t('measurement:errors.systemRecordOnlyAdmin');
      } else {
        msg = raw;
      }
    }
    setFormError(msg);
    toast.error(msg);
  };

  const create = trpc.measurement.create.useMutation({
    onSuccess: async () => {
      toast.success(t('measurement:toast.created'));
      await utils.measurement.listByPatient.invalidate({ patientId });
      onSaved();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const update = trpc.measurement.update.useMutation({
    onSuccess: async () => {
      toast.success(t('measurement:toast.updated'));
      await Promise.all([
        utils.measurement.listByPatient.invalidate({ patientId }),
        existing ? utils.measurement.findById.invalidate({ id: existing.id }) : Promise.resolve(),
      ]);
      onSaved();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const date = new Date(measuredAt);
    if (isNaN(date.getTime())) {
      setFormError(t('measurement:errors.invalidDate'));
      return;
    }

    // Sayısal alanları parse'la, boş string'leri at.
    const cleaned: MeasurementValues = {};
    for (const f of fields) {
      const raw = values[f.key];
      if (raw === undefined || raw === null || raw === '') continue;
      if (f.input === 'number') {
        const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
        if (!isNaN(num)) cleaned[f.key] = num;
      } else {
        cleaned[f.key] = String(raw);
      }
    }

    const payload = {
      eyeSide,
      measuredAt: date.toISOString(),
      values: cleaned,
      notes: notes.trim() || null,
    };

    if (isEdit && existing) {
      update.mutate({ id: existing.id, data: payload });
    } else {
      create.mutate({ patientId, type, ...payload });
    }
  };

  const submitting = create.isPending || update.isPending;
  const titleKey = isEdit ? 'measurement:form.editTitle' : 'measurement:form.createTitle';
  const submitKey = isEdit ? 'measurement:form.update' : 'measurement:form.submit';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>{t(titleKey)}</DialogTitle>
        <DialogDescription>{t('measurement:form.description')}</DialogDescription>
        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="m-type">{t('measurement:form.fields.type')}</Label>
            <select
              id="m-type"
              data-testid="measurement-type"
              value={type}
              onChange={(e) => {
                setType(e.target.value as SupportedFormType);
                setValues({});
              }}
              disabled={isEdit}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {SUPPORTED_FORM_TYPES.map((tk) => (
                <option key={tk} value={tk}>
                  {t(`measurement:types.${tk}`)}
                </option>
              ))}
            </select>
          </div>

          {/* S15-PR6 — Göz tarafı zorunlu (yanlış göz cerrahisi #1 sebep).
              v0.4.2 G1: ortak <EyeSideField> (airmed-design Ray 4). Mevcut davranış korunur
              (OU varsayılan, measurement:eyeSide etiketleri, measurement-eye-* testid'leri). */}
          <EyeSideField
            value={eyeSide}
            onChange={setEyeSide}
            label={t('measurement:form.fields.eyeSide')}
            testIdPrefix="measurement-eye"
            optionLabel={(side) => t(`measurement:eyeSide.${side}`)}
          />

          <div className="space-y-1.5">
            <Label htmlFor="m-datetime">{t('measurement:form.fields.measuredAt')}</Label>
            <DateTimeField id="m-datetime" value={measuredAt} onChange={setMeasuredAt} />
          </div>

          <section className="space-y-2 rounded-md border bg-muted/30 p-3">
            <h3 className="text-sm font-medium">{t('measurement:form.fields.valuesTitle')}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`m-val-${f.key}`}>
                    {t(`measurement:fields.${type}.${f.key}`)}
                    {f.unit && (
                      <span className="ml-1 text-xs text-muted-foreground">({f.unit})</span>
                    )}
                  </Label>
                  <Input
                    id={`m-val-${f.key}`}
                    data-testid={`measurement-field-${f.key}`}
                    type={f.input}
                    step={f.step}
                    min={f.min}
                    max={f.max}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </section>

          <div className="space-y-1.5">
            <Label htmlFor="m-notes">{t('measurement:form.fields.notes')}</Label>
            <textarea
              id="m-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <Button type="submit" disabled={submitting} data-testid="measurement-submit">
              {submitting ? t('measurement:form.submitting') : t(submitKey)}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
