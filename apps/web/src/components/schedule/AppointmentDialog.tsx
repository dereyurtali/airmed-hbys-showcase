import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { DateField, TimeField } from '../ui/date-field';
import { Label } from '../ui/label';
import { PatientCommandPicker, type SelectedPatient } from './PatientCommandPicker';
import {
  APPOINTMENT_TYPE_META,
  CREATABLE_APPOINTMENT_TYPES,
  isCreatableAppointmentType,
  type AppointmentType,
} from '../../lib/appointment.constants';
import { trpc } from '../../lib/trpc';
import { cn } from '../../lib/utils';
import { useClinic } from '../../hooks/useClinic';
import { useUnsavedWarning, confirmIfDirty } from '../../hooks/useUnsavedWarning';

// Madde 4 — Klinik Ayarları'nda yönetici farklı varsayılan girmediyse 30 dk.
const FALLBACK_SLOT_MINUTES = 30;

export type PrefilledPatient = SelectedPatient;

export interface ExistingAppointment {
  id: string;
  patient: SelectedPatient;
  // #367 — Doktorsuz (havuz) randevu düzenlenebilir.
  doctorId: string | null;
  type: AppointmentType;
  startsAt: Date;
  endsAt: Date;
  notes: string | null;
}

type Mode = 'create' | 'edit';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: Mode;
  // CREATE mode: slot click context (start/end/doctor); patient may be prefilled.
  // EDIT mode: existing appointment row (patient/doctor immutable, only type/time/notes editable).
  defaultStartsAt: Date;
  defaultEndsAt: Date;
  defaultDoctorId: string;
  // #1048 — type opsiyonel: verilirse misafir doktor pencere erken-uyarısı
  // aktifleşir (SchedulePage doctor.list'ten geçirir; eski çağıranlar kırılmaz).
  doctorOptions: { id: string; name: string; type?: string }[];
  prefilledPatient?: PrefilledPatient | null;
  // R3 (#725) — create modunda randevu tipini ön-seç (recall → 'control' prefill).
  defaultType?: AppointmentType;
  existing?: ExistingAppointment | null;
  onCreated: () => void;
  onUpdated?: () => void;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function toTimeInput(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function applyTime(base: Date, hhmm: string): Date {
  const [hh, mm] = hhmm.split(':').map((s) => parseInt(s, 10));
  const next = new Date(base);
  next.setHours(hh ?? 0, mm ?? 0, 0, 0);
  return next;
}

// #399 — Native date input için Date ↔ YYYY-MM-DD (yerel).
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
function parseDateInput(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

// "HH:MM" + minutes → "HH:MM" (gün taşması 24'e mod alarak temizlenir).
function addMinutesToTimeInput(hhmm: string, minutes: number): string {
  const [hh, mm] = hhmm.split(':').map((s) => parseInt(s, 10));
  const total = (hh ?? 0) * 60 + (mm ?? 0) + minutes;
  const next = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad2(Math.floor(next / 60))}:${pad2(next % 60)}`;
}

export function AppointmentDialog({
  open,
  onOpenChange,
  mode = 'create',
  defaultStartsAt,
  defaultEndsAt,
  defaultDoctorId,
  doctorOptions,
  prefilledPatient,
  defaultType,
  existing,
  onCreated,
  onUpdated,
}: Props) {
  const { t } = useTranslation('appointment');
  const { t: tc } = useTranslation('common');
  const utils = trpc.useUtils();
  const clinic = useClinic();
  const slotMinutes = clinic.defaultAppointmentMinutes ?? FALLBACK_SLOT_MINUTES;

  const [patient, setPatient] = useState<SelectedPatient | null>(null);
  const [doctorId, setDoctorId] = useState<string>(defaultDoctorId);
  const [type, setType] = useState<AppointmentType>('consultation');
  const [startTime, setStartTime] = useState<string>(toTimeInput(defaultStartsAt));
  const [endTime, setEndTime] = useState<string>(toTimeInput(defaultEndsAt));
  // #399 — Düzenlenebilir tarih (ileri tarih randevu + başka güne taşıma).
  const [dateStr, setDateStr] = useState<string>(toDateInput(defaultStartsAt));
  // Madde 4 — bitiş saati manuel değiştirilmediği sürece başlangıç değişince
  // varsayılan süreye göre otomatik güncellenir.
  const [endTimeTouched, setEndTimeTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // SİS-8 — Açılışta snapshot; sonra editable alanlar değiştiyse "dirty".
  const initialRef = useRef('');
  const justSubmittedRef = useRef(false);
  const snapshot = JSON.stringify({
    patientId: patient?.id ?? '',
    doctorId,
    type,
    startTime,
    endTime,
    dateStr,
    notes,
  });
  const dirty = !justSubmittedRef.current && snapshot !== initialRef.current;

  const isEdit = mode === 'edit';
  // #399 — Date base artık düzenlenebilir tarih alanından (eskiden slot/existing
  // gününe sabitti → ileri tarih = ±1 gün spam, taşıma imkânsızdı).
  const dateBase = parseDateInput(dateStr);

  // ---- #1048: erken uyarı (izin / geliş penceresi) + boş slot önerici -------

  const selectedDoctorType = doctorOptions.find((d) => d.id === doctorId)?.type;

  // Kayıttan ÖNCE uyarı: backend zaten reddeder (assertDoctorAvailable), ama
  // kullanıcı formu doldurup 4xx yemesin — inline uyarı submit'i BLOKLAMAZ.
  const leavesQuery = trpc.doctor.listLeaves.useQuery(
    { doctorId },
    { enabled: open && !!doctorId, staleTime: 30_000 },
  );
  const windowsQuery = trpc.doctor.listVisitingWindows.useQuery(
    { doctorId },
    { enabled: open && !!doctorId && selectedDoctorType === 'visiting', staleTime: 30_000 },
  );

  const availabilityWarningKey = useMemo(() => {
    if (!doctorId || !startTime || !endTime) return null;
    const base = parseDateInput(dateStr);
    const startsAt = applyTime(base, startTime);
    const endsAt = applyTime(base, endTime);
    const onLeave = (leavesQuery.data ?? []).some(
      (l) => new Date(l.startsAt) < endsAt && new Date(l.endsAt) > startsAt,
    );
    if (onLeave) return 'dialog.warnings.onLeave';
    if (selectedDoctorType === 'visiting' && windowsQuery.data) {
      if (windowsQuery.data.length === 0) return 'dialog.warnings.noWindow';
      const inWindow = windowsQuery.data.some(
        (w) => new Date(w.startsAt) <= startsAt && new Date(w.endsAt) >= endsAt,
      );
      if (!inWindow) return 'dialog.warnings.outsideWindow';
    }
    return null;
  }, [
    doctorId,
    selectedDoctorType,
    dateStr,
    startTime,
    endTime,
    leavesQuery.data,
    windowsQuery.data,
  ]);

  // Boş slot önerici — yalnız create modunda (edit'te randevunun kendi saati
  // "dolu" görünür, öneri yanıltır). Süre = klinik varsayılanı; slotMinutes
  // şemada zaten [5,240] kısıtlı (clinic-settings.schemas), yalnız 5'in katına
  // yuvarlanır.
  const suggestDuration = Math.round(slotMinutes / 5) * 5;
  const dayRange = useMemo(() => {
    const from = parseDateInput(dateStr);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
  }, [dateStr]);
  const freeSlotsQuery = trpc.availability.freeSlots.useQuery(
    {
      doctorId,
      dateFrom: dayRange.dateFrom,
      dateTo: dayRange.dateTo,
      durationMinutes: suggestDuration,
    },
    { enabled: open && !isEdit && !!doctorId, staleTime: 30_000, retry: false },
  );
  const freeSlots = useMemo(
    () => freeSlotsQuery.data?.doctors.find((d) => d.doctorId === doctorId)?.slots ?? [],
    [freeSlotsQuery.data, doctorId],
  );
  // Dialog şişmesin: önce 8 çip, kalanlar "daha fazla" ile.
  const SLOT_PREVIEW_COUNT = 8;
  const [showAllSlots, setShowAllSlots] = useState(false);
  const visibleSlots = showAllSlots ? freeSlots : freeSlots.slice(0, SLOT_PREVIEW_COUNT);

  const applySuggestedSlot = (iso: string) => {
    const hhmm = toTimeInput(new Date(iso));
    setStartTime(hhmm);
    setEndTime(addMinutesToTimeInput(hhmm, suggestDuration));
    setEndTimeTouched(false);
  };

  // Re-prefill when the parent re-opens with a different slot/appointment.
  useEffect(() => {
    if (!open) return;
    justSubmittedRef.current = false;
    let snap: typeof initialRef.current;
    if (isEdit && existing) {
      setPatient(existing.patient);
      setDoctorId(existing.doctorId ?? '');
      setType(existing.type);
      setStartTime(toTimeInput(existing.startsAt));
      setEndTime(toTimeInput(existing.endsAt));
      setDateStr(toDateInput(existing.startsAt));
      setNotes(existing.notes ?? '');
      snap = JSON.stringify({
        patientId: existing.patient.id,
        doctorId: existing.doctorId ?? '',
        type: existing.type,
        startTime: toTimeInput(existing.startsAt),
        endTime: toTimeInput(existing.endsAt),
        dateStr: toDateInput(existing.startsAt),
        notes: existing.notes ?? '',
      });
    } else {
      setPatient(prefilledPatient ?? null);
      setDoctorId(defaultDoctorId);
      setType(defaultType ?? 'consultation');
      setStartTime(toTimeInput(defaultStartsAt));
      setEndTime(toTimeInput(defaultEndsAt));
      setDateStr(toDateInput(defaultStartsAt));
      setEndTimeTouched(false);
      setNotes('');
      snap = JSON.stringify({
        patientId: prefilledPatient?.id ?? '',
        doctorId: defaultDoctorId,
        type: defaultType ?? 'consultation',
        startTime: toTimeInput(defaultStartsAt),
        endTime: toTimeInput(defaultEndsAt),
        dateStr: toDateInput(defaultStartsAt),
        notes: '',
      });
    }
    initialRef.current = snap;
    setFormError(null);
    setShowAllSlots(false);
  }, [
    open,
    isEdit,
    existing,
    defaultDoctorId,
    defaultStartsAt,
    defaultEndsAt,
    prefilledPatient,
    defaultType,
  ]);

  const handleConflict = (msg: string) => {
    setFormError(msg);
    toast.error(msg);
  };

  const create = trpc.appointment.create.useMutation({
    onSuccess: async () => {
      await utils.appointment.findInRange.invalidate();
      toast.success(t('toast.created'));
      justSubmittedRef.current = true;
      onCreated();
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof TRPCClientError && err.data?.code === 'CONFLICT') {
        handleConflict(t('dialog.errors.conflict'));
        return;
      }
      const msg = err instanceof TRPCClientError ? err.message : t('toast.unknownError');
      setFormError(msg);
      toast.error(msg);
    },
  });

  const update = trpc.appointment.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.appointment.findInRange.invalidate(),
        existing && utils.appointment.findById.invalidate({ id: existing.id }),
      ]);
      toast.success(t('toast.updated'));
      justSubmittedRef.current = true;
      onUpdated?.();
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof TRPCClientError && err.data?.code === 'CONFLICT') {
        handleConflict(t('dialog.errors.conflict'));
        return;
      }
      const msg = err instanceof TRPCClientError ? err.message : t('toast.unknownError');
      setFormError(msg);
      toast.error(msg);
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!isEdit && !patient) {
      setFormError(t('dialog.errors.patientRequired'));
      return;
    }
    // #367 — Doktorsuz "genel randevu" geçerli (havuz); doctorId zorunlu değil.
    const startsAt = applyTime(dateBase, startTime);
    const endsAt = applyTime(dateBase, endTime);
    if (startsAt >= endsAt) {
      setFormError(t('dialog.errors.endBeforeStart'));
      return;
    }

    if (isEdit && existing) {
      update.mutate({
        id: existing.id,
        data: {
          type,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          notes: notes.trim() || null,
        },
      });
    } else {
      create.mutate({
        patientId: patient!.id,
        doctorId: doctorId || undefined,
        type,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        notes: notes.trim() || null,
      });
    }
  };

  const submitting = create.isPending || update.isPending;
  const titleKey = isEdit ? 'dialog.edit.title' : 'dialog.create.title';
  const descKey = isEdit ? 'dialog.edit.description' : 'dialog.create.description';
  const submitKey = isEdit ? 'dialog.edit.submit' : 'dialog.create.submit';
  const submittingKey = isEdit ? 'dialog.edit.submitting' : 'dialog.create.submitting';

  const selectedDoctorName = doctorOptions.find((d) => d.id === doctorId)?.name ?? doctorId;

  // SİS-8 — Sekme kapat/yenile uyarısı + dialog kapanışında teyit.
  useUnsavedWarning(open && dirty);
  const requestClose = (next: boolean) => {
    if (!next && dirty && !confirmIfDirty(true, tc('forms.unsavedConfirm'))) return;
    onOpenChange(next);
  };

  // Tetkik/pre_op/post_op manuel seçilmez. Düzenlenen randevu zaten bu tiplerden
  // biriyse, kilitli olarak göstermek için listeye başa eklenir (kullanıcı görsün,
  // seçilebilir bir tipe çevirebilsin ama geri dönemesin).
  const typeOptions =
    isEdit && existing && !isCreatableAppointmentType(existing.type)
      ? [existing.type, ...CREATABLE_APPOINTMENT_TYPES]
      : CREATABLE_APPOINTMENT_TYPES;

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{t(titleKey)}</DialogTitle>
        <DialogDescription>{t(descKey)}</DialogDescription>
        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <Label>{t('dialog.fields.patient')}</Label>
            {isEdit && patient ? (
              <div className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">
                    {patient.firstName} {patient.lastName}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">{patient.mrn}</span>
                </span>
                <span className="text-xs text-muted-foreground">{t('dialog.fields.locked')}</span>
              </div>
            ) : (
              <PatientCommandPicker selected={patient} onSelect={setPatient} />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="appointment-doctor">{t('dialog.fields.doctor')}</Label>
            {isEdit ? (
              <div className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2 text-sm">
                <span className="font-medium">{selectedDoctorName}</span>
                <span className="text-xs text-muted-foreground">{t('dialog.fields.locked')}</span>
              </div>
            ) : (
              <select
                id="appointment-doctor"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* #367 — Doktorsuz "genel randevu": check-in'de müsait doktora atanır. */}
                <option value="">
                  {t('dialog.fields.anyDoctor', { defaultValue: 'Doktor fark etmez (havuz)' })}
                </option>
                {doctorOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t('dialog.fields.type')}</Label>
            <ul className="flex flex-wrap gap-1.5" role="radiogroup">
              {typeOptions.map((typeOpt) => {
                const meta = APPOINTMENT_TYPE_META[typeOpt];
                const Icon = meta.icon;
                const active = type === typeOpt;
                const locked = !isCreatableAppointmentType(typeOpt);
                return (
                  <li key={typeOpt}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={locked}
                      onClick={() => {
                        if (!locked) setType(typeOpt);
                      }}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
                        active
                          ? `${meta.bg} ${meta.color} ${meta.border}`
                          : 'border-input text-muted-foreground hover:bg-muted',
                        locked && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {t(meta.labelKey)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* #399 — Düzenlenebilir tarih: ileri tarih randevu + başka güne taşıma. */}
          <div className="space-y-1.5">
            <Label htmlFor="appointment-date">
              {t('dialog.fields.date', { defaultValue: 'Tarih' })}
            </Label>
            <DateField id="appointment-date" value={dateStr} onChange={(v) => v && setDateStr(v)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="appointment-start">{t('dialog.fields.startTime')}</Label>
              <TimeField
                id="appointment-start"
                value={startTime}
                onChange={(newStart) => {
                  setStartTime(newStart);
                  // Madde 4 — kullanıcı bitişe dokunmadıysa varsayılan süreye göre yeniden hesapla.
                  if (!endTimeTouched && newStart && slotMinutes > 0) {
                    setEndTime(addMinutesToTimeInput(newStart, slotMinutes));
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appointment-end">{t('dialog.fields.endTime')}</Label>
              <TimeField
                id="appointment-end"
                value={endTime}
                onChange={(v) => {
                  setEndTime(v);
                  setEndTimeTouched(true);
                }}
              />
            </div>
          </div>

          {/* #1048 — kayıttan ÖNCE inline uyarı (submit'i bloklamaz; son söz
              service-layer'da). Amber = durumsal engel, hata değil. */}
          {availabilityWarningKey && (
            <p
              role="status"
              data-testid="appointment-availability-warning"
              className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-foreground"
            >
              {t(availabilityWarningKey)}
            </p>
          )}

          {/* #1048 — boş slot önerici: çipe tıkla → saat alanları dolar. */}
          {!isEdit && doctorId && (
            <div className="space-y-1.5">
              <Label>{t('dialog.slots.title')}</Label>
              {freeSlotsQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">{t('dialog.slots.loading')}</p>
              ) : freeSlots.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('dialog.slots.empty')}</p>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {visibleSlots.map((iso) => {
                    const hhmm = toTimeInput(new Date(iso));
                    const active = hhmm === startTime;
                    return (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => applySuggestedSlot(iso)}
                        aria-pressed={active}
                        className={cn(
                          'rounded-md border px-2 py-1 text-xs tabular-nums transition-colors',
                          active
                            ? 'border-primary/40 bg-primary/10 font-medium text-primary'
                            : 'border-input text-muted-foreground hover:bg-muted',
                        )}
                      >
                        {hhmm}
                      </button>
                    );
                  })}
                  {!showAllSlots && freeSlots.length > SLOT_PREVIEW_COUNT && (
                    <button
                      type="button"
                      onClick={() => setShowAllSlots(true)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5"
                    >
                      {t('dialog.slots.more', { count: freeSlots.length - SLOT_PREVIEW_COUNT })}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="appointment-notes">{t('dialog.fields.notes')}</Label>
            <textarea
              id="appointment-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={t('dialog.fields.notesPlaceholder')}
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
            <Button type="button" variant="outline" onClick={() => requestClose(false)}>
              {t('dialog.create.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t(submittingKey) : t(submitKey)}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
