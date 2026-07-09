import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DateTimeField } from '../ui/date-field';
import { Label } from '../ui/label';
import {
  INTRA_OP_FIELDS,
  POST_OP_FIELDS,
  PRE_OP_FIELDS,
  SURGERY_STATUSES,
  type SurgeryIntraOp,
  type SurgeryPostOp,
  type SurgeryPreOp,
  type SurgeryStatus,
} from '../../lib/surgery.constants';
import { trpc } from '../../lib/trpc';
import { ROLES } from '@airmed/contracts';
import { useAuth } from '../../providers/AuthProvider';
import { useUnsavedWarning, confirmIfDirty } from '../../hooks/useUnsavedWarning';

type Mode = 'create' | 'edit';

// Sadece-doktor (ameliyat satış/yönetim rolü yok) yeni ameliyat oluştururken
// = "öneri": tarih vermez (satış planlar). Düzenlemede tüm alanlar açık.
const NON_DOCTOR_SURGERY_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
];

export interface ExistingSurgery {
  id: string;
  type: string;
  doctorId: string;
  status: SurgeryStatus;
  scheduledAt: Date;
  performedAt: Date | null;
  preOp: SurgeryPreOp;
  intraOp: SurgeryIntraOp;
  postOp: SurgeryPostOp;
  complicationFlag: boolean;
  complicationNotes: string | null;
}

interface DoctorOption {
  id: string;
  name: string;
  specialty: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: Mode;
  patientId: string;
  doctors: DoctorOption[];
  existing?: ExistingSurgery | null;
  onSaved: () => void;
}

function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SurgeryForm({
  open,
  onOpenChange,
  mode = 'create',
  patientId,
  doctors,
  existing,
  onSaved,
}: Props) {
  const { t } = useTranslation(['surgery', 'common']);
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const isEdit = mode === 'edit';
  // Doktor öneri modu: yeni ameliyat oluştururken tarih alanları gizli (öneri;
  // tarih + paket ameliyat satış tarafından belirlenir).
  const isDoctorRecommending =
    !isEdit &&
    !!user &&
    user.roles.includes(ROLES.DOKTOR) &&
    !user.roles.some((r) => NON_DOCTOR_SURGERY_ROLES.includes(r));

  const [type, setType] = useState('');
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? '');
  const [status, setStatus] = useState<SurgeryStatus>('planned');
  const [scheduledAt, setScheduledAt] = useState(toDateTimeLocal(new Date()));
  const [performedAt, setPerformedAt] = useState('');
  const [preOp, setPreOp] = useState<SurgeryPreOp>({});
  const [intraOp, setIntraOp] = useState<SurgeryIntraOp>({});
  const [postOp, setPostOp] = useState<SurgeryPostOp>({});
  const [complicationFlag, setComplicationFlag] = useState(false);
  const [complicationNotes, setComplicationNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // SİS-8 — Açılış snapshot'ı; sonra alanlar değiştiyse "dirty".
  const initialRef = useRef('');
  const justSubmittedRef = useRef(false);
  const snapshot = JSON.stringify({
    type,
    doctorId,
    status,
    scheduledAt,
    performedAt,
    preOp,
    intraOp,
    postOp,
    complicationFlag,
    complicationNotes,
  });
  const dirty = !justSubmittedRef.current && snapshot !== initialRef.current;

  useEffect(() => {
    if (!open) return;
    justSubmittedRef.current = false;
    let snap: string;
    if (isEdit && existing) {
      setType(existing.type);
      setDoctorId(existing.doctorId);
      setStatus(existing.status);
      setScheduledAt(toDateTimeLocal(existing.scheduledAt));
      setPerformedAt(existing.performedAt ? toDateTimeLocal(existing.performedAt) : '');
      setPreOp(existing.preOp ?? {});
      setIntraOp(existing.intraOp ?? {});
      setPostOp(existing.postOp ?? {});
      setComplicationFlag(existing.complicationFlag);
      setComplicationNotes(existing.complicationNotes ?? '');
      snap = JSON.stringify({
        type: existing.type,
        doctorId: existing.doctorId,
        status: existing.status,
        scheduledAt: toDateTimeLocal(existing.scheduledAt),
        performedAt: existing.performedAt ? toDateTimeLocal(existing.performedAt) : '',
        preOp: existing.preOp ?? {},
        intraOp: existing.intraOp ?? {},
        postOp: existing.postOp ?? {},
        complicationFlag: existing.complicationFlag,
        complicationNotes: existing.complicationNotes ?? '',
      });
    } else {
      const initDoctor = doctors[0]?.id ?? '';
      const now = toDateTimeLocal(new Date());
      setType('');
      setDoctorId(initDoctor);
      setStatus('planned');
      setScheduledAt(now);
      setPerformedAt('');
      setPreOp({});
      setIntraOp({});
      setPostOp({});
      setComplicationFlag(false);
      setComplicationNotes('');
      snap = JSON.stringify({
        type: '',
        doctorId: initDoctor,
        status: 'planned',
        scheduledAt: now,
        performedAt: '',
        preOp: {},
        intraOp: {},
        postOp: {},
        complicationFlag: false,
        complicationNotes: '',
      });
    }
    initialRef.current = snap;
    setFormError(null);
  }, [open, isEdit, existing, doctors]);

  const handleError = (err: unknown) => {
    let msg = t('surgery:errors.unknown');
    if (err instanceof TRPCClientError) {
      const raw = err.message;
      if (raw.includes('Same-day edit window expired')) {
        msg = t('surgery:errors.sameDayExpired');
      } else if (raw.includes('Only the operating surgeon or yonetici')) {
        msg = t('surgery:errors.onlyOwnerOrAdmin');
      } else {
        msg = raw;
      }
    }
    setFormError(msg);
    toast.error(msg);
  };

  const create = trpc.surgery.create.useMutation({
    onSuccess: async (data) => {
      toast.success(t('surgery:toast.created'));
      justSubmittedRef.current = true;
      // #381 — Soft uyarılar: hastanın muayenesi yoksa / satış kuyruğuna düşmediyse.
      const w = (data as { warnings?: { noExamination?: boolean; handoffAdvanced?: boolean } })
        .warnings;
      if (w?.noExamination) {
        toast.warning(
          t('surgery:warning.noExamination', {
            defaultValue: 'Uyarı: Bu hastanın muayene kaydı yok — cerrahi yine de kaydedildi.',
          }),
        );
      }
      if (w && w.handoffAdvanced === false) {
        toast.warning(
          t('surgery:warning.handoffNotAdvanced', {
            defaultValue:
              'Bilgi: Aktif ziyaret satış kuyruğuna ilerletilemedi; gerekirse manuel devredin.',
          }),
        );
      }
      await utils.surgery.listByPatient.invalidate({ patientId });
      onSaved();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const update = trpc.surgery.update.useMutation({
    onSuccess: async () => {
      toast.success(t('surgery:toast.updated'));
      justSubmittedRef.current = true;
      await Promise.all([
        utils.surgery.listByPatient.invalidate({ patientId }),
        existing && utils.surgery.findById.invalidate({ id: existing.id }),
      ]);
      onSaved();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const typed = type.trim();
    if (!typed) {
      setFormError(t('surgery:errors.typeRequired'));
      return;
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      setFormError(t('surgery:errors.invalidDate'));
      return;
    }

    const performedDate = performedAt ? new Date(performedAt) : null;
    if (performedDate && isNaN(performedDate.getTime())) {
      setFormError(t('surgery:errors.invalidDate'));
      return;
    }

    const payload = {
      type: typed,
      status,
      scheduledAt: scheduledDate.toISOString(),
      performedAt: performedDate ? performedDate.toISOString() : null,
      preOp: preOp as Record<string, unknown>,
      intraOp: intraOp as Record<string, unknown>,
      postOp: postOp as Record<string, unknown>,
      complicationFlag,
      complicationNotes: complicationNotes.trim() || null,
    };

    if (isEdit && existing) {
      update.mutate({ id: existing.id, data: payload });
    } else {
      create.mutate({
        patientId,
        doctorId,
        ...payload,
      });
    }
  };

  const submitting = create.isPending || update.isPending;
  const titleKey = isEdit ? 'surgery:form.editTitle' : 'surgery:form.createTitle';
  const submitKey = isEdit ? 'surgery:form.update' : 'surgery:form.submit';

  // SİS-8 — Sekme kapat/yenile uyarısı + dialog kapanışında teyit.
  useUnsavedWarning(open && dirty);
  const requestClose = (next: boolean) => {
    if (!next && dirty && !confirmIfDirty(true, t('common:forms.unsavedConfirm'))) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>{t(titleKey)}</DialogTitle>
        <DialogDescription>{t('surgery:form.description')}</DialogDescription>
        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="surgery-type">{t('surgery:form.fields.type')}</Label>
              <Input
                id="surgery-type"
                type="text"
                maxLength={100}
                value={type}
                onChange={(e) => setType(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="surgery-doctor">{t('surgery:form.fields.doctor')}</Label>
              <select
                id="surgery-doctor"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                required
                disabled={isEdit}
              >
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — {d.specialty}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="surgery-status">{t('surgery:form.fields.status')}</Label>
              <select
                id="surgery-status"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={status}
                onChange={(e) => setStatus(e.target.value as SurgeryStatus)}
              >
                {SURGERY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`surgery:status.${s}`)}
                  </option>
                ))}
              </select>
            </div>
            {!isDoctorRecommending && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="surgery-scheduled">{t('surgery:form.fields.scheduledAt')}</Label>
                  <DateTimeField
                    id="surgery-scheduled"
                    value={scheduledAt}
                    onChange={setScheduledAt}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="surgery-performed">{t('surgery:form.fields.performedAt')}</Label>
                  <DateTimeField
                    id="surgery-performed"
                    value={performedAt}
                    onChange={setPerformedAt}
                  />
                </div>
              </>
            )}
            {isDoctorRecommending && (
              <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
                {t('surgery:form.doctorRecommendNote')}
              </p>
            )}
          </div>

          <JsonbSection
            title={t('surgery:form.fields.preOpTitle')}
            fields={PRE_OP_FIELDS}
            namespace="preOp"
            t={t}
            data={preOp as Record<string, string | undefined>}
            onChange={(k, v) => setPreOp((prev) => ({ ...prev, [k]: v }))}
          />
          <JsonbSection
            title={t('surgery:form.fields.intraOpTitle')}
            fields={INTRA_OP_FIELDS}
            namespace="intraOp"
            t={t}
            data={intraOp as Record<string, string | undefined>}
            onChange={(k, v) => setIntraOp((prev) => ({ ...prev, [k]: v }))}
          />
          <JsonbSection
            title={t('surgery:form.fields.postOpTitle')}
            fields={POST_OP_FIELDS}
            namespace="postOp"
            t={t}
            data={postOp as Record<string, string | undefined>}
            onChange={(k, v) => setPostOp((prev) => ({ ...prev, [k]: v }))}
          />

          <section className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={complicationFlag}
                onChange={(e) => setComplicationFlag(e.target.checked)}
              />
              {t('surgery:form.fields.complicationFlag')}
            </label>
            {complicationFlag && (
              <div className="space-y-1.5">
                <Label htmlFor="surgery-complication-notes">
                  {t('surgery:form.fields.complicationNotes')}
                </Label>
                <textarea
                  id="surgery-complication-notes"
                  value={complicationNotes}
                  onChange={(e) => setComplicationNotes(e.target.value)}
                  maxLength={5000}
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )}
          </section>

          {formError && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => requestClose(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={submitting || doctors.length === 0}>
              {submitting ? t('surgery:form.submitting') : t(submitKey)}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface JsonbSectionProps<F extends string> {
  title: string;
  fields: readonly F[];
  namespace: 'preOp' | 'intraOp' | 'postOp';
  t: (key: string) => string;
  data: Record<string, string | undefined>;
  onChange: (key: F, value: string) => void;
}

function JsonbSection<F extends string>({
  title,
  fields,
  namespace,
  t,
  data,
  onChange,
}: JsonbSectionProps<F>) {
  return (
    <section className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((key) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`surgery-${namespace}-${key}`}>
              {t(`surgery:${namespace}.${key}`)}
            </Label>
            <Input
              id={`surgery-${namespace}-${key}`}
              type="text"
              maxLength={500}
              value={data[key] ?? ''}
              onChange={(e) => onChange(key, e.target.value)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
