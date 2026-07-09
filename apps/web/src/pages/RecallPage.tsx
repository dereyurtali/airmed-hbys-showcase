import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CalendarPlus, Calendar, Phone, MessageSquare, Mail, Plus } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { EmptyState } from '../components/ui/empty-state';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
import { AppointmentDialog } from '../components/schedule/AppointmentDialog';
import { usePermission } from '../hooks/usePermission';
import { confirmIfDirty } from '../hooks/useUnsavedWarning';
import { trpc } from '../lib/trpc';
import { mapTrpcError } from '../lib/trpc-error';
import { useLocale } from '../providers/LocaleProvider';
import { formatDateTime } from '../lib/i18n-format';

// S15-PR20 — Post-op takip kayıp hastalar ekranı. Doktor ameliyatından sonra
// 1.gün / 1.hafta / 1.ay / 3.ay kontrolleri planlar (PR9 SurgeryDayCenter
// otomatik yapar). Kaçıran (no-show veya geçmiş scheduled) hastaları burada
// listeler; klinik personeli SMS/telefon ile çağırır, attempt audit kaydolur.

type Bucket = 'missed' | 'today' | 'next7days';

interface RecallAttempt {
  id: string;
  method: string;
  result: string;
  attemptedAt: string;
  attemptedBy: { name: string };
}

interface RecallRow {
  id: string;
  startsAt: string;
  status: string;
  notes: string | null;
  patient: { id: string; mrn: string; firstName: string; lastName: string; phone: string | null };
  doctor: { user: { name: string } | null } | null;
  recallAttempts: RecallAttempt[];
}

// Delta audit A-1: `trpc as unknown as` cast'i kaldırıldı; gerçek hook'lar
// (`rows` typesi local interface'e dar cast — AppRouter type depth P1 #3.25).

const BUCKET_LABEL: Record<Bucket, string> = {
  missed: 'Kaçırılanlar',
  today: 'Bugün',
  next7days: 'Önümüzdeki 7 gün',
};

const METHOD_ICON: Record<string, typeof Phone> = {
  sms: MessageSquare,
  phone: Phone,
  email: Mail,
};

export function RecallPage() {
  const { t } = useTranslation(['recall', 'common']);
  const { locale } = useLocale();
  const [bucket, setBucket] = useState<Bucket>('missed');
  const [logFor, setLogFor] = useState<RecallRow | null>(null);
  // R3 (#725) — "Ara → kontrol randevu prefill": kaçan hastaya doğrudan kontrol
  // randevusu (type='control') aç, hasta + tip ön-dolu. Yetkililer randevu açabilir.
  const [scheduleFor, setScheduleFor] = useState<RecallRow | null>(null);
  const canSchedule = usePermission('action:appointment.create');
  const doctorsQuery = trpc.doctor.list.useQuery(
    { isActive: true, page: 1, pageSize: 200 },
    { enabled: canSchedule },
  );
  const doctorOptions = useMemo(
    () => doctorsQuery.data?.items.map((d) => ({ id: d.id, name: d.name })) ?? [],
    [doctorsQuery.data],
  );
  // Varsayılan slot: yarın 09:00 (+30 dk). Kullanıcı dialogda değiştirir.
  const slot = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + 30);
    return { start, end };
  }, []);
  const [method, setMethod] = useState<'sms' | 'phone' | 'email'>('phone');
  const [result, setResult] = useState<
    'reached' | 'no_answer' | 'rescheduled' | 'voicemail' | 'wrong_number'
  >('reached');
  const [notes, setNotes] = useState('');

  const utils = trpc.useUtils();
  const listQuery = trpc.recall.list.useQuery(
    { bucket },
    { refetchInterval: 60_000, refetchIntervalInBackground: false },
  );

  const logMutation = trpc.recall.logAttempt.useMutation();

  const rows = (listQuery.data ?? []) as RecallRow[];

  return (
    <div className="space-y-6">
      <PageHeader title={t('recall:page.title')} description={t('recall:page.description')} />

      <div className="flex flex-wrap items-center gap-2">
        {(['missed', 'today', 'next7days'] as Bucket[]).map((b) => (
          <Button
            key={b}
            size="sm"
            variant={bucket === b ? 'default' : 'outline'}
            onClick={() => setBucket(b)}
          >
            {t(`recall:bucket.${b}`, { defaultValue: BUCKET_LABEL[b] })}
          </Button>
        ))}
      </div>

      {listQuery.isLoading && (
        <div className="text-sm text-muted-foreground">{t('common:loading')}</div>
      )}

      {!listQuery.isLoading && rows.length === 0 && <EmptyState title={t('recall:page.empty')} />}

      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex items-start justify-between rounded-lg border bg-card p-3"
            data-testid={`recall-row-${r.id}`}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {r.patient.firstName} {r.patient.lastName}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{r.patient.mrn}</span>
                <Badge variant={r.status === 'no_show' ? 'critical' : 'warning'}>
                  {t(`recall:status.${r.status}`, { defaultValue: r.status })}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatDateTime(r.startsAt, locale)} · {r.doctor?.user?.name ?? '—'}
              </div>
              {r.patient.phone && (
                <div className="mt-1 text-xs">
                  <Phone className="mr-1 inline h-3 w-3" />
                  {r.patient.phone}
                </div>
              )}
              {r.recallAttempts.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {r.recallAttempts.map((a) => {
                    const Icon = METHOD_ICON[a.method] ?? Phone;
                    return (
                      <div key={a.id} className="text-[11px] text-muted-foreground">
                        <Icon className="mr-1 inline h-3 w-3" />
                        {t(`recall:method.${a.method}`, { defaultValue: a.method })} ·{' '}
                        {t(`recall:result.${a.result}`, { defaultValue: a.result })} ·{' '}
                        {a.attemptedBy.name} · {formatDateTime(a.attemptedAt, locale)}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLogFor(r);
                  setMethod('phone');
                  setResult('reached');
                  setNotes('');
                }}
                data-testid={`log-attempt-${r.id}`}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('recall:attempt.log')}
              </Button>
              {/* R3 (#725) — "Kontrol Randevusu": kaçan hastaya doğrudan kontrol
                  randevusu aç (hasta + tip='control' ön-dolu). */}
              {canSchedule && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setScheduleFor(r)}
                  data-testid={`schedule-control-${r.id}`}
                >
                  <CalendarPlus className="mr-1 h-3.5 w-3.5" />
                  {t('recall:scheduleControl')}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* R3 (#725) — Kontrol randevusu (type='control', hasta ön-dolu). */}
      {scheduleFor && (
        <AppointmentDialog
          open={scheduleFor !== null}
          onOpenChange={(next) => !next && setScheduleFor(null)}
          mode="create"
          defaultStartsAt={slot.start}
          defaultEndsAt={slot.end}
          defaultDoctorId={doctorOptions[0]?.id ?? ''}
          doctorOptions={doctorOptions}
          defaultType="control"
          prefilledPatient={{
            id: scheduleFor.patient.id,
            firstName: scheduleFor.patient.firstName,
            lastName: scheduleFor.patient.lastName,
            mrn: scheduleFor.patient.mrn,
          }}
          onCreated={() => {
            toast.success(t('recall:scheduleControlSuccess'));
            setScheduleFor(null);
            void utils.recall.list.invalidate();
          }}
        />
      )}

      <Dialog
        open={logFor !== null}
        onOpenChange={(next) => {
          if (next || logMutation.isPending) return;
          const dirty = method !== 'phone' || result !== 'reached' || notes !== '';
          if (!confirmIfDirty(dirty, t('common:forms.unsavedConfirm'))) return;
          setLogFor(null);
        }}
      >
        <DialogContent>
          {logFor && (
            <>
              <DialogTitle className="mb-3 text-base">
                {t('recall:attempt.title')} — {logFor.patient.firstName} {logFor.patient.lastName}
              </DialogTitle>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  logMutation.mutate(
                    {
                      appointmentId: logFor.id,
                      method,
                      result,
                      notes: notes.trim() || null,
                    },
                    {
                      onSuccess: () => {
                        toast.success(t('recall:attempt.success'));
                        setLogFor(null);
                        setNotes('');
                        void utils.recall.list.invalidate();
                      },
                      onError: (err) => toast.error(mapTrpcError(err, t)),
                    },
                  );
                }}
              >
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">{t('recall:attempt.method')}</span>
                  <select
                    className="focus-ring h-10 w-full rounded-lg border border-field bg-background px-3 text-sm hover:border-field-hover"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as typeof method)}
                    data-testid="attempt-method"
                  >
                    <option value="phone">Phone</option>
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">{t('recall:attempt.result')}</span>
                  <select
                    className="focus-ring h-10 w-full rounded-lg border border-field bg-background px-3 text-sm hover:border-field-hover"
                    value={result}
                    onChange={(e) => setResult(e.target.value as typeof result)}
                    data-testid="attempt-result"
                  >
                    <option value="reached">{t('recall:attempt.results.reached')}</option>
                    <option value="no_answer">{t('recall:attempt.results.no_answer')}</option>
                    <option value="voicemail">{t('recall:attempt.results.voicemail')}</option>
                    <option value="rescheduled">{t('recall:attempt.results.rescheduled')}</option>
                    <option value="wrong_number">{t('recall:attempt.results.wrong_number')}</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">{t('recall:attempt.notes')}</span>
                  <textarea
                    className="focus-ring min-h-[60px] w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={500}
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setLogFor(null)}>
                    {t('common:actions.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={logMutation.isPending}
                    data-testid="attempt-submit"
                  >
                    {t('recall:attempt.save')}
                  </Button>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
