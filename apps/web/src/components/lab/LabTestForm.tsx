import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DateTimeField } from '../ui/date-field';
import { Label } from '../ui/label';
import {
  ACCEPT_FILE_MIMES,
  LAB_TEST_TYPES,
  MAX_FILE_BYTES,
  isOphthalmicType,
  type LabTestSource,
  type LabTestType,
} from '../../lib/lab.constants';
import { api } from '../../lib/api';
import { trpc } from '../../lib/trpc';
import {
  validateBiometryField,
  calculateIolPowerSRK2,
  type BiometryRange,
} from '../../lib/iol-power';

type Mode = 'create' | 'edit';

// #420 — Biyometri yapısal alanları. Boş string = girilmemiş; numara parse'i
// gönderme/hesap anında yapılır (serbest yazımı engellemez, aralık uyarısı verir).
interface BiometryEye {
  al: string;
  k1: string;
  k2: string;
  acd: string;
}

interface BiometryState {
  od: BiometryEye;
  os: BiometryEye;
  aConstant: string;
  targetRefraction: string;
}

const EMPTY_EYE: BiometryEye = { al: '', k1: '', k2: '', acd: '' };
const DEFAULT_A_CONSTANT = '118.4';
const DEFAULT_TARGET_REFRACTION = '0';

function emptyBiometry(): BiometryState {
  return {
    od: { ...EMPTY_EYE },
    os: { ...EMPTY_EYE },
    aConstant: DEFAULT_A_CONSTANT,
    targetRefraction: DEFAULT_TARGET_REFRACTION,
  };
}

export interface ExistingLabTest {
  id: string;
  source: LabTestSource;
  testType: LabTestType;
  performedAt: string | Date;
  results: Record<string, unknown> | null;
  notes: string | null;
  externalLab: string | null;
  fileName: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: Mode;
  patientId: string;
  existing?: ExistingLabTest | null;
  onSaved: () => void;
}

function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function LabTestForm({
  open,
  onOpenChange,
  mode = 'create',
  patientId,
  existing,
  onSaved,
}: Props) {
  const { t } = useTranslation(['lab', 'common']);
  const utils = trpc.useUtils();
  const isEdit = mode === 'edit';

  const [source, setSource] = useState<LabTestSource>('internal');
  const [testType, setTestType] = useState<LabTestType>('visual_field');
  const [performedAt, setPerformedAt] = useState(toDateTimeLocal(new Date()));
  const [notes, setNotes] = useState('');
  const [externalLab, setExternalLab] = useState('');
  // Internal results — yapılandırılmış girilebilen alanlar (basit OD/OS)
  const [od, setOd] = useState('');
  const [os, setOs] = useState('');
  const [extraField, setExtraField] = useState(''); // ör: MD / PSD / axial length
  // #420 — Biyometri yapısal alt-form state'i
  const [biometry, setBiometry] = useState<BiometryState>(emptyBiometry());
  // External file
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (isEdit && existing) {
      setSource(existing.source);
      setTestType(existing.testType);
      const d =
        typeof existing.performedAt === 'string'
          ? new Date(existing.performedAt)
          : existing.performedAt;
      setPerformedAt(toDateTimeLocal(d));
      setNotes(existing.notes ?? '');
      setExternalLab(existing.externalLab ?? '');
      const r = existing.results ?? {};
      setOd(asStr(r.od) || asStr(r.axialLengthOd));
      setOs(asStr(r.os) || asStr(r.axialLengthOs));
      setExtraField(asStr(r.md) || asStr(r.psd) || '');
      setBiometry(hydrateBiometry(r));
    } else {
      setSource('internal');
      setTestType('visual_field');
      setPerformedAt(toDateTimeLocal(new Date()));
      setNotes('');
      setExternalLab('');
      setOd('');
      setOs('');
      setExtraField('');
      setBiometry(emptyBiometry());
    }
    setFile(null);
    setFormError(null);
  }, [open, isEdit, existing]);

  const handleError = (err: unknown) => {
    let msg = t('lab:errors.unknown');
    if (err instanceof TRPCClientError) {
      const raw = err.message;
      if (raw.includes('Same-day edit window expired')) {
        msg = t('lab:errors.sameDayExpired');
      } else if (raw.includes('Only the recording user or yonetici')) {
        msg = t('lab:errors.onlyOwnerOrAdmin');
      } else if (raw.includes('System-imported lab tests')) {
        msg = t('lab:errors.systemRecordOnlyAdmin');
      } else {
        msg = raw;
      }
    }
    setFormError(msg);
    toast.error(msg);
  };

  const create = trpc.lab.create.useMutation({
    onSuccess: async (created: { id: string }) => {
      // External tetkikte dosya seçilmişse upload et.
      if (source === 'external' && file) {
        try {
          const fd = new FormData();
          fd.append('file', file);
          await api.post(`/lab-tests/${created.id}/file`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch (err) {
          const e = err as { response?: { data?: { message?: string } }; message?: string };
          toast.warning(
            t('lab:toast.fileFailed', { message: e.response?.data?.message ?? e.message ?? '' }),
          );
        }
      }
      toast.success(t('lab:toast.created'));
      await utils.lab.listByPatient.invalidate({ patientId });
      onSaved();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const update = trpc.lab.update.useMutation({
    onSuccess: async () => {
      toast.success(t('lab:toast.updated'));
      await utils.lab.listByPatient.invalidate({ patientId });
      onSaved();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const results =
      testType === 'biometry'
        ? buildBiometryResults(biometry)
        : buildResults(testType, od, os, extraField);

    if (isEdit && existing) {
      update.mutate({
        id: existing.id,
        data: {
          testType,
          performedAt: new Date(performedAt).toISOString(),
          results,
          notes: notes.trim() || null,
          externalLab: externalLab.trim() || null,
        },
      });
    } else {
      if (source === 'external' && file) {
        if (
          !ACCEPT_FILE_MIMES.includes(file.type.toLowerCase() as (typeof ACCEPT_FILE_MIMES)[number])
        ) {
          setFormError(t('lab:errors.mimeNotAllowed'));
          return;
        }
        if (file.size > MAX_FILE_BYTES) {
          setFormError(t('lab:errors.tooLarge'));
          return;
        }
      }
      setSubmitting(true);
      create.mutate(
        {
          patientId,
          source,
          testType,
          performedAt: new Date(performedAt).toISOString(),
          results,
          notes: notes.trim() || null,
          externalLab: source === 'external' ? externalLab.trim() || null : null,
        },
        {
          onSettled: () => setSubmitting(false),
        },
      );
    }
  };

  const isOphthalmic = isOphthalmicType(testType);
  const isBiometry = testType === 'biometry';
  const showOdOs = isOphthalmic && (testType === 'iop_curve' || testType === 'pachymetry');
  const showExtraField = testType === 'visual_field';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{isEdit ? t('lab:form.editTitle') : t('lab:form.createTitle')}</DialogTitle>
        <DialogDescription>{t('lab:form.description')}</DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          {!isEdit && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{t('lab:form.source')}</legend>
              <div className="flex gap-3">
                {(['internal', 'external'] as const).map((s) => (
                  <label key={s} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="lab-source"
                      checked={source === s}
                      onChange={() => setSource(s)}
                    />
                    {t(`lab:source.${s}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lab-type">{t('lab:form.testType')}</Label>
              <select
                id="lab-type"
                className="flex h-10 w-full focus-ring rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
                value={testType}
                onChange={(e) => setTestType(e.target.value as LabTestType)}
              >
                {LAB_TEST_TYPES.map((tt) => (
                  <option key={tt} value={tt}>
                    {t(`lab:types.${tt}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lab-performedAt">{t('lab:form.performedAt')}</Label>
              <DateTimeField id="lab-performedAt" value={performedAt} onChange={setPerformedAt} />
            </div>
          </div>

          {showOdOs && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lab-od">{t('lab:form.od')}</Label>
                <Input id="lab-od" value={od} onChange={(e) => setOd(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lab-os">{t('lab:form.os')}</Label>
                <Input id="lab-os" value={os} onChange={(e) => setOs(e.target.value)} />
              </div>
            </div>
          )}

          {isBiometry && <BiometrySubForm value={biometry} onChange={setBiometry} />}

          {showExtraField && (
            <div className="space-y-1.5">
              <Label htmlFor="lab-md-psd">{t('lab:form.mdPsd')}</Label>
              <Input
                id="lab-md-psd"
                value={extraField}
                onChange={(e) => setExtraField(e.target.value)}
                placeholder="MD -3.2 / PSD 2.5"
              />
            </div>
          )}

          {source === 'external' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="lab-externalLab">{t('lab:form.externalLab')}</Label>
                <Input
                  id="lab-externalLab"
                  value={externalLab}
                  onChange={(e) => setExternalLab(e.target.value)}
                  maxLength={200}
                  placeholder={t('lab:form.externalLabPlaceholder')}
                />
              </div>
              {!isEdit && (
                <div className="space-y-1.5">
                  <Label htmlFor="lab-file">{t('lab:form.file')}</Label>
                  <Input
                    id="lab-file"
                    type="file"
                    accept={ACCEPT_FILE_MIMES.join(',')}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  {file && (
                    <p className="text-xs text-muted-foreground">
                      {file.name} · {formatBytes(file.size)}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="lab-notes">{t('lab:form.notes')}</Label>
            <textarea
              id="lab-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={3}
              className="flex w-full focus-ring rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
            />
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm text-critical-foreground"
            >
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={submitting || create.isPending || update.isPending}>
              {isEdit ? t('lab:form.submitUpdate') : t('lab:form.submitCreate')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function asStr(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

function buildResults(
  type: LabTestType,
  od: string,
  os: string,
  extra: string,
): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  if (type === 'iop_curve') {
    if (od) r.od = od;
    if (os) r.os = os;
  } else if (type === 'pachymetry') {
    if (od) r.od = od;
    if (os) r.os = os;
  } else if (type === 'biometry') {
    if (od) r.axialLengthOd = od;
    if (os) r.axialLengthOs = os;
  } else if (type === 'visual_field') {
    if (extra) {
      const parts = extra.split('/').map((s) => s.trim());
      if (parts[0]) r.md = parts[0].replace(/^MD\s*/i, '');
      if (parts[1]) r.psd = parts[1].replace(/^PSD\s*/i, '');
    }
  }
  return r;
}

// #420 — Düzenlemede eski/yeni biyometri kayıtlarını state'e doldur.
// Eski kayıt yalnız axialLengthOd/Os tutuyorsa K/ACD boş gelir (graceful).
function hydrateBiometry(r: Record<string, unknown>): BiometryState {
  return {
    od: {
      al: asStr(r.axialLengthOd),
      k1: asStr(r.k1Od),
      k2: asStr(r.k2Od),
      acd: asStr(r.acdOd),
    },
    os: {
      al: asStr(r.axialLengthOs),
      k1: asStr(r.k1Os),
      k2: asStr(r.k2Os),
      acd: asStr(r.acdOs),
    },
    aConstant: asStr(r.aConstant) || DEFAULT_A_CONSTANT,
    targetRefraction: asStr(r.targetRefraction) || DEFAULT_TARGET_REFRACTION,
  };
}

// #420 — Yapısal biyometri results JSONB. Boş alanlar atlanır; sayılar string
// olarak saklanır (diğer lab sonuçları gibi). axialLengthOd/Os geri uyum için
// korunur. IOL gücü hesaplanabiliyorsa karar-destek değeri de kaydedilir.
function buildBiometryResults(b: BiometryState): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  if (b.od.al) r.axialLengthOd = b.od.al;
  if (b.os.al) r.axialLengthOs = b.os.al;
  if (b.od.k1) r.k1Od = b.od.k1;
  if (b.od.k2) r.k2Od = b.od.k2;
  if (b.od.acd) r.acdOd = b.od.acd;
  if (b.os.k1) r.k1Os = b.os.k1;
  if (b.os.k2) r.k2Os = b.os.k2;
  if (b.os.acd) r.acdOs = b.os.acd;
  if (b.aConstant) r.aConstant = b.aConstant;
  if (b.targetRefraction) r.targetRefraction = b.targetRefraction;
  const odPower = eyeIolPower(b.od, b.aConstant, b.targetRefraction);
  const osPower = eyeIolPower(b.os, b.aConstant, b.targetRefraction);
  if (odPower != null) r.iolPowerOd = String(odPower);
  if (osPower != null) r.iolPowerOs = String(osPower);
  return r;
}

// Boş string number parse'i NaN verir → calculateIolPowerSRK2 null döner.
function eyeIolPower(eye: BiometryEye, aConstant: string, targetRefraction: string): number | null {
  const al = Number(eye.al);
  const k1 = Number(eye.k1);
  const k2 = Number(eye.k2);
  if (!eye.al || !eye.k1 || !eye.k2) return null;
  return calculateIolPowerSRK2({
    axialLength: al,
    meanK: (k1 + k2) / 2,
    aConstant: Number(aConstant),
    targetRefraction: targetRefraction ? Number(targetRefraction) : 0,
  });
}

function BiometrySubForm({
  value,
  onChange,
}: {
  value: BiometryState;
  onChange: (next: BiometryState) => void;
}) {
  const { t } = useTranslation(['lab']);
  const setEye = (eye: 'od' | 'os', patch: Partial<BiometryEye>) =>
    onChange({ ...value, [eye]: { ...value[eye], ...patch } });

  return (
    <div className="space-y-4 rounded-lg border border-field p-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BiometryEyeColumn
          label={t('lab:biometry.od')}
          idPrefix="biometry-od"
          eye={value.od}
          onPatch={(p) => setEye('od', p)}
          power={eyeIolPower(value.od, value.aConstant, value.targetRefraction)}
          t={t}
        />
        <BiometryEyeColumn
          label={t('lab:biometry.os')}
          idPrefix="biometry-os"
          eye={value.os}
          onPatch={(p) => setEye('os', p)}
          power={eyeIolPower(value.os, value.aConstant, value.targetRefraction)}
          t={t}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="biometry-aconstant">{t('lab:biometry.aConstant')}</Label>
          <Input
            id="biometry-aconstant"
            inputMode="decimal"
            value={value.aConstant}
            onChange={(e) => onChange({ ...value, aConstant: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="biometry-target">{t('lab:biometry.targetRefraction')}</Label>
          <Input
            id="biometry-target"
            inputMode="decimal"
            value={value.targetRefraction}
            onChange={(e) => onChange({ ...value, targetRefraction: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

function BiometryEyeColumn({
  label,
  idPrefix,
  eye,
  onPatch,
  power,
  t,
}: {
  label: string;
  idPrefix: string;
  eye: BiometryEye;
  onPatch: (patch: Partial<BiometryEye>) => void;
  power: number | null;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const fields: {
    key: keyof BiometryEye;
    field: Parameters<typeof validateBiometryField>[0];
    label: string;
  }[] = [
    { key: 'al', field: 'axialLength', label: t('lab:biometry.axialLength') },
    { key: 'k1', field: 'k1', label: t('lab:biometry.k1') },
    { key: 'k2', field: 'k2', label: t('lab:biometry.k2') },
    { key: 'acd', field: 'acd', label: t('lab:biometry.acd') },
  ];

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {fields.map(({ key, field, label: fieldLabel }) => {
        const raw = eye[key];
        const range: BiometryRange | null =
          raw.trim() !== '' ? validateBiometryField(field, Number(raw)) : null;
        const id = `${idPrefix}-${key}`;
        return (
          <div key={key} className="space-y-1">
            <Label htmlFor={id} className="text-xs">
              {fieldLabel}
            </Label>
            <Input
              id={id}
              inputMode="decimal"
              value={raw}
              onChange={(e) => onPatch({ [key]: e.target.value })}
              aria-invalid={range != null}
            />
            {range && (
              <p className="text-xs text-warning-foreground">
                {t('lab:biometry.outOfRange', {
                  min: range.min,
                  max: range.max,
                  unit: range.unit,
                })}
              </p>
            )}
          </div>
        );
      })}
      {power != null && (
        <div className="space-y-0.5 pt-1">
          <p className="text-sm font-medium text-foreground">
            {t('lab:biometry.iolPower', { power })}
          </p>
          <p className="text-xs text-muted-foreground">{t('lab:biometry.iolCaveat')}</p>
        </div>
      )}
    </div>
  );
}
