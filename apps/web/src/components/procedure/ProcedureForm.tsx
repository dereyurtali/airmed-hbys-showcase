import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DateTimeField } from '../ui/date-field';
import { Label } from '../ui/label';
import {
  ANESTHESIA_TYPES,
  COMMON_IVT_DRUGS,
  EYE_SIDES,
  PROCEDURE_SETTINGS_FIELDS,
  PROCEDURE_STATUSES,
  PROCEDURE_TYPES,
  type AnesthesiaType,
  type EyeSide,
  type ProcedureStatus,
  type ProcedureType,
} from '../../lib/procedure.constants';
import { trpc } from '../../lib/trpc';

const SELECT_CLASS =
  'focus-ring flex h-10 w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover';

interface Doctor {
  id: string;
  name: string;
  specialty: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  doctors: Doctor[];
  defaultDoctorId?: string;
  onSaved: () => void;
}

function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ProcedureForm({
  open,
  onOpenChange,
  patientId,
  doctors,
  defaultDoctorId,
  onSaved,
}: Props) {
  const { t } = useTranslation(['procedure', 'common']);
  const utils = trpc.useUtils();

  const [type, setType] = useState<ProcedureType>('intravitreal_injection');
  const [eyeSide, setEyeSide] = useState<EyeSide>('od');
  const [anesthesia, setAnesthesia] = useState<AnesthesiaType>('topical');
  const [status, setStatus] = useState<ProcedureStatus>('performed');
  const [doctorId, setDoctorId] = useState<string>('');
  const [performedAt, setPerformedAt] = useState<string>(toDateTimeLocal(new Date()));
  const [drugUsed, setDrugUsed] = useState('');
  const [drugDose, setDrugDose] = useState('');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [findings, setFindings] = useState('');
  const [complications, setComplications] = useState('');
  const [notes, setNotes] = useState('');
  const [autoFollowUp, setAutoFollowUp] = useState(true);
  const [followUpDays, setFollowUpDays] = useState('7');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType('intravitreal_injection');
    setEyeSide('od');
    setAnesthesia('topical');
    setStatus('performed');
    setDoctorId(defaultDoctorId ?? doctors[0]?.id ?? '');
    setPerformedAt(toDateTimeLocal(new Date()));
    setDrugUsed('');
    setDrugDose('');
    setSettings({});
    setFindings('');
    setComplications('');
    setNotes('');
    setAutoFollowUp(true);
    setFollowUpDays('7');
    setFormError(null);
  }, [open, defaultDoctorId, doctors]);

  const settingFields = useMemo(() => PROCEDURE_SETTINGS_FIELDS[type], [type]);

  const handleError = (err: unknown) => {
    let msg = t('procedure:errors.unknown');
    if (err instanceof TRPCClientError) {
      const raw = err.message;
      if (raw.includes('Only the operating doctor') || raw.includes('Forbidden')) {
        msg = t('procedure:errors.forbidden');
      } else if (raw.includes('not found')) {
        msg = t('procedure:errors.notFound');
      } else {
        msg = raw;
      }
    }
    setFormError(msg);
    toast.error(msg);
  };

  const create = trpc.procedure.create.useMutation({
    onSuccess: async (res) => {
      if (res && (res as { followUpSkipped?: boolean }).followUpSkipped) {
        toast.warning(t('procedure:toast.savedFollowUpSkipped'));
      } else {
        toast.success(t('procedure:toast.created'));
      }
      await Promise.all([
        utils.procedure.list.invalidate({ patientId }),
        utils.procedure.series.invalidate({ patientId }),
      ]);
      onSaved();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!doctorId) {
      setFormError(t('procedure:errors.selectDoctor'));
      return;
    }
    // settings: number fields'i number'a çevir
    const settingsParsed: Record<string, string | number> = {};
    for (const f of settingFields) {
      const raw = settings[f.key];
      if (raw === undefined || raw === '') continue;
      if (f.type === 'number') {
        const n = Number(raw);
        if (!Number.isNaN(n)) settingsParsed[f.key] = n;
      } else {
        settingsParsed[f.key] = raw;
      }
    }
    create.mutate({
      patientId,
      doctorId,
      type,
      eyeSide,
      anesthesia,
      status,
      drugUsed: drugUsed.trim() || undefined,
      drugDose: drugDose.trim() || undefined,
      settings: settingsParsed,
      findings: findings.trim() || undefined,
      complications: complications.trim() || undefined,
      notes: notes.trim() || undefined,
      performedAt: new Date(performedAt).toISOString(),
      autoScheduleFollowUp: autoFollowUp,
      followUpDaysFromNow: Number(followUpDays) || 7,
    });
  };

  const showDrugFields = type === 'intravitreal_injection';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogTitle>{t('procedure:form.title')}</DialogTitle>
        <DialogDescription>{t('procedure:form.description')}</DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 space-y-4" data-testid="procedure-form">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="proc-type">{t('procedure:form.fields.type')}</Label>
              <select
                id="proc-type"
                className={SELECT_CLASS}
                value={type}
                onChange={(e) => {
                  setType(e.target.value as ProcedureType);
                  setSettings({});
                }}
              >
                {PROCEDURE_TYPES.map((tp) => (
                  <option key={tp} value={tp}>
                    {t(`procedure:types.${tp}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="proc-doctor">{t('procedure:form.fields.doctor')}</Label>
              <select
                id="proc-doctor"
                className={SELECT_CLASS}
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                required
              >
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — {d.specialty}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="proc-eye">{t('procedure:form.fields.eyeSide')}</Label>
              <select
                id="proc-eye"
                className={SELECT_CLASS}
                value={eyeSide}
                onChange={(e) => setEyeSide(e.target.value as EyeSide)}
              >
                {EYE_SIDES.map((s) => (
                  <option key={s} value={s}>
                    {t(`procedure:eyeSide.${s}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="proc-anes">{t('procedure:form.fields.anesthesia')}</Label>
              <select
                id="proc-anes"
                className={SELECT_CLASS}
                value={anesthesia}
                onChange={(e) => setAnesthesia(e.target.value as AnesthesiaType)}
              >
                {ANESTHESIA_TYPES.map((a) => (
                  <option key={a} value={a}>
                    {t(`procedure:anesthesia.${a}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="proc-performed">{t('procedure:form.fields.performedAt')}</Label>
              <DateTimeField id="proc-performed" value={performedAt} onChange={setPerformedAt} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="proc-status">{t('procedure:form.fields.status')}</Label>
              <select
                id="proc-status"
                className={SELECT_CLASS}
                value={status}
                onChange={(e) => setStatus(e.target.value as ProcedureStatus)}
              >
                {PROCEDURE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`procedure:status.${s}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {showDrugFields && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('procedure:form.sections.drug')}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proc-drug">{t('procedure:form.fields.drugUsed')}</Label>
                <Input
                  id="proc-drug"
                  list="ivt-drug-suggestions"
                  value={drugUsed}
                  onChange={(e) => setDrugUsed(e.target.value)}
                  placeholder={t('procedure:form.placeholders.drugUsed')}
                />
                <datalist id="ivt-drug-suggestions">
                  {COMMON_IVT_DRUGS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proc-dose">{t('procedure:form.fields.drugDose')}</Label>
                <Input
                  id="proc-dose"
                  value={drugDose}
                  onChange={(e) => setDrugDose(e.target.value)}
                  placeholder="0.5 mg"
                />
              </div>
            </div>
          )}

          {settingFields.length > 0 && (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                {t('procedure:form.sections.settings')}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {settingFields.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={`proc-set-${f.key}`}>
                      {t(`procedure:settings.${f.key}`, { defaultValue: f.key })}
                      {f.unit ? ` (${f.unit})` : ''}
                    </Label>
                    <Input
                      id={`proc-set-${f.key}`}
                      type={f.type === 'number' ? 'number' : 'text'}
                      step={f.step}
                      min={f.min}
                      max={f.max}
                      value={settings[f.key] ?? ''}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="proc-findings">{t('procedure:form.fields.findings')}</Label>
            <textarea
              id="proc-findings"
              className="focus-ring flex min-h-[60px] w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              maxLength={2000}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proc-complications">{t('procedure:form.fields.complications')}</Label>
            <textarea
              id="proc-complications"
              className="focus-ring flex min-h-[60px] w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
              value={complications}
              onChange={(e) => setComplications(e.target.value)}
              maxLength={2000}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proc-notes">{t('procedure:form.fields.notes')}</Label>
            <textarea
              id="proc-notes"
              className="focus-ring flex min-h-[60px] w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
            />
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoFollowUp}
                onChange={(e) => setAutoFollowUp(e.target.checked)}
                data-testid="proc-auto-followup"
              />
              {t('procedure:form.fields.autoFollowUp')}
            </label>
            {autoFollowUp && (
              <div className="flex items-center gap-2 text-sm">
                <Label htmlFor="proc-followup-days" className="m-0">
                  {t('procedure:form.fields.followUpDays')}
                </Label>
                <Input
                  id="proc-followup-days"
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  className="w-24"
                  value={followUpDays}
                  onChange={(e) => setFollowUpDays(e.target.value)}
                />
              </div>
            )}
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
            <Button type="submit" disabled={create.isPending} data-testid="procedure-submit">
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('procedure:form.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
