import { localeToIntl } from '../lib/i18n-format';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Receipt,
  Settings2,
  Star,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { InvoiceCreateDialog } from '../components/billing/InvoiceCreateDialog';
import { PaymentDialog } from '../components/billing/PaymentDialog';
import { cn } from '../lib/utils';
import { ENCOUNTER_STAGE_META, type EncounterStage } from '../lib/encounter.constants';
import {
  APPOINTMENT_TYPE_META,
  isMeasurementDefaultCheckin,
  type AppointmentType,
} from '../lib/appointment.constants';
import { trpc } from '../lib/trpc';
import { mapTrpcError } from '../lib/trpc-error';
import type { Currency } from '../lib/billing.constants';
import type { InvoiceRow } from '../lib/billing.trpc';
import { useLocale } from '../providers/LocaleProvider';

// Resepsiyon karşılama kokpiti — eski /reception-queue sayfasının yerine geçer.
// 3-pane: bugünkü randevular, ödeme bekleyenler, bugün tamamlananlar.
// Tek tıkla check-in → fatura → tahsilat → makbuz zinciri sürer (dialog state machine).

type ChainStep =
  | { kind: 'idle' }
  | {
      kind: 'invoice';
      patientId: string;
      patientName: string;
      // v0.4.2 Karar 4 — check-in akışında randevu tipi → fatura ilk kalemi auto-prefill.
      appointmentId?: string;
      appointmentType?: AppointmentType;
    }
  | {
      kind: 'payment';
      invoiceId: string;
      currency: Currency;
      openBalance: number;
      patientName: string;
    };

interface AppointmentRow {
  id: string;
  startsAt: string;
  status: string;
  type: string;
  // #377 — Cerrahi randevuda ölçüm güncel değilse resepsiyona uyarı.
  measurementStale?: boolean;
  patient: {
    id: string;
    mrn: string;
    firstName: string;
    lastName: string;
    tags?: string[] | null;
    // #375 — İkinci görüş intake (LeadSource) → kokpit rozeti.
    leadSource?: string | null;
  };
  doctor: { id: string; name: string };
}

interface ReceptionRow {
  id: string;
  stage: EncounterStage;
  hasPaidSession: boolean;
  // #424 — Göz acili triyaj önceliği.
  isUrgent?: boolean;
  patient: { id: string; mrn: string; firstName: string; lastName: string; tags?: string[] };
}

// Randevu tipi rozeti — resepsiyon "Geldi"de hastanın hangi tür randevuyla
// geldiğini (ve dolayısıyla nereye yönleneceğini) bir bakışta görsün.
function AppointmentTypeBadge({ type }: { type: AppointmentType }) {
  const { t } = useTranslation('appointment');
  const meta = APPOINTMENT_TYPE_META[type];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        meta.bg,
        meta.color,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(meta.labelKey)}
    </span>
  );
}

export function ReceptionCockpitPage() {
  const { t } = useTranslation(['receptionQueue', 'billing', 'appointment', 'worklist']);
  const { locale } = useLocale();
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(localeToIntl(locale) ?? 'tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );

  const utils = trpc.useUtils();

  const dayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const dayEnd = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }, []);

  const appointments = trpc.appointment.findInRange.useQuery(
    { dateFrom: dayStart, dateTo: dayEnd },
    { refetchInterval: 30_000 },
  );
  // #1066 — reception-sidebar aynı anahtarı zaten 30sn'de poll'lüyor (her
  // ekranda canlı); bu sayfa cache'i interval'siz okur → çift timer yok.
  const queue = trpc.encounter.receptionQueue.useQuery(undefined);
  const looseList = trpc.appointment.list as unknown as {
    useQuery: (
      input: {
        status?: string;
        dateFrom?: string;
        dateTo?: string;
        page: number;
        pageSize: number;
      },
      opts?: { refetchInterval?: number },
    ) => {
      data?: { items: AppointmentRow[] };
      isLoading: boolean;
      error: { message: string } | null;
    };
  };
  const completed = looseList.useQuery(
    {
      status: 'completed',
      dateFrom: dayStart,
      dateTo: dayEnd,
      page: 1,
      pageSize: 10,
    },
    { refetchInterval: 60_000 },
  );

  const appointmentRows = (appointments.data ?? []) as unknown as AppointmentRow[];
  const queueRows = (queue.data ?? []) as unknown as ReceptionRow[];
  const completedRows = (completed.data?.items ?? []) as unknown as AppointmentRow[];

  // #411 — Saat sırası (VIP-first sıralama saati karıştırıyordu; VIP artık yalnız
  // satır rozetiyle vurgulanır, kuyruk saatine göre kalır). arrivable status filtresi.
  const arrivable = useMemo(
    () =>
      appointmentRows
        .filter((a) => a.status === 'scheduled' || a.status === 'checked_in')
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [appointmentRows],
  );

  const [chain, setChain] = useState<ChainStep>({ kind: 'idle' });
  const [pendingCheckIn, setPendingCheckIn] = useState<{
    patientId: string;
    patientName: string;
    appointmentId: string;
    appointmentType: AppointmentType;
  } | null>(null);
  const closeChain = () => setChain({ kind: 'idle' });

  const checkIn = trpc.appointment.checkIn.useMutation({
    onSuccess: async () => {
      if (pendingCheckIn) {
        setChain({ kind: 'invoice', ...pendingCheckIn });
        setPendingCheckIn(null);
      }
      await Promise.all([
        utils.appointment.findInRange.invalidate(),
        utils.encounter.receptionQueue.invalidate(),
      ]);
    },
    onError: (err) => {
      setPendingCheckIn(null);
      toast.error(mapTrpcError(err, t));
    },
  });

  // #424 — Göz acili triyaj: ziyareti acil/normal işaretle (kuyruk önceliği).
  const setUrgent = trpc.encounter.setUrgent.useMutation({
    onSuccess: async () => {
      await utils.encounter.receptionQueue.invalidate();
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });

  // #407 — "Gönder" (encounter.advance): ödeme bekleyen ziyaret doktora/ölçüme
  // geçince reception kuyruğundan çıkar → satırı optimistik kaldır, hata olursa
  // geri al. receptionQueue key'i undefined (parametresiz query).
  const advance = trpc.encounter.advance.useMutation({
    onMutate: async (vars) => {
      await utils.encounter.receptionQueue.cancel();
      const prev = utils.encounter.receptionQueue.getData(undefined);
      utils.encounter.receptionQueue.setData(
        undefined,
        (old) =>
          (old as unknown as ReceptionRow[] | undefined)?.filter((r) => r.id !== vars.id) as never,
      );
      return { prev };
    },
    // #395 — S12c 403 ham backend mesajına düşmesin; hazır error.* anahtarlarına
    // bağla. Hedef stage'den kategoriyi türet (waiting_doctor→exam, in_measurement→ölçüm).
    onError: (err, vars, ctx) => {
      if (ctx?.prev) utils.encounter.receptionQueue.setData(undefined, ctx.prev);
      const httpStatus = (err.data as { httpStatus?: number } | undefined)?.httpStatus;
      if (httpStatus === 403) {
        toast.error(
          vars.toStage === 'in_measurement'
            ? t('receptionQueue:error.measurementUnpaid')
            : t('receptionQueue:error.examUnpaid'),
        );
        return;
      }
      toast.error(mapTrpcError(err, t));
    },
    onSettled: () => {
      void utils.encounter.receptionQueue.invalidate();
      void utils.appointment.list.invalidate();
    },
  });

  const onInvoiceCreated = (inv: InvoiceRow) => {
    setChain({
      kind: 'payment',
      invoiceId: inv.id,
      currency: inv.currency,
      openBalance: parseFloat(inv.total),
      patientName:
        chain.kind === 'invoice'
          ? chain.patientName
          : `${inv.patient.firstName} ${inv.patient.lastName}`,
    });
  };

  const onPaid = () => {
    toast.success(t('receptionQueue:cockpit.toastPaid'), {
      description: chain.kind === 'payment' ? chain.patientName : undefined,
    });
  };

  // "Geldi": istasyon verilmezse backend randevu tipine göre seçer
  // (muayene/kontrol → ölçüm, girişimsel → doktor); 'examination' override'ı
  // ölçüm-default tipleri doğrudan doktora gönderir.
  const doCheckIn = (a: AppointmentRow, initialStation?: 'measurement' | 'examination') => {
    setPendingCheckIn({
      patientId: a.patient.id,
      patientName: `${a.patient.firstName} ${a.patient.lastName}`,
      appointmentId: a.id,
      appointmentType: a.type as AppointmentType,
    });
    checkIn.mutate({ id: a.id, ...(initialStation ? { initialStation } : {}) });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('receptionQueue:cockpit.title')}
        description={t('receptionQueue:cockpit.description')}
        actions={
          <div className="flex items-center gap-2">
            {/* #411 — Walk-in / yeni randevu CTA (randevu ekranına götürür). */}
            <Link
              to="/schedule"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              data-testid="cockpit-walkin"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {t('receptionQueue:cockpit.walkInCta', { defaultValue: 'Yeni randevu' })}
            </Link>
            <Link
              to="/reception/preferences"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              data-testid="cockpit-prefs-link"
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t('receptionQueue:cockpit.prefsLink')}
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Pane
          icon={<ClipboardCheck className="h-4 w-4" />}
          title={t('receptionQueue:cockpit.todays')}
          count={arrivable.length}
          loading={appointments.isLoading}
          empty={arrivable.length === 0 ? t('receptionQueue:cockpit.todaysEmpty') : null}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('receptionQueue:cockpit.colTime')}</TableHead>
                <TableHead>{t('receptionQueue:cockpit.colPatient')}</TableHead>
                <TableHead className="text-right">
                  {t('receptionQueue:cockpit.colArrive')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {arrivable.map((a) => (
                <TableRow key={a.id} data-testid="cockpit-appt-row">
                  <TableCell className="font-mono text-xs">
                    {timeFmt.format(new Date(a.startsAt))}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        {a.patient.firstName} {a.patient.lastName}
                        {(a.patient.tags ?? []).includes('vip') && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning-foreground">
                            <Star className="h-3 w-3 fill-current" aria-hidden /> VIP
                          </span>
                        )}
                        {/* #375 — İkinci görüş hastası rozeti. */}
                        {a.patient.leadSource === 'second_opinion' && (
                          <span className="inline-flex items-center rounded-full border border-info-border bg-info-bg px-2 py-0.5 text-[10px] font-semibold text-info-foreground">
                            {t('receptionQueue:cockpit.secondOpinion', {
                              defaultValue: 'İkinci görüş',
                            })}
                          </span>
                        )}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {a.patient.mrn}
                        </span>
                        {/* #411 — Doktor görünürlüğü (eskiden kokpitte yoktu). */}
                        {a.doctor?.name && (
                          <span className="text-xs text-muted-foreground">· {a.doctor.name}</span>
                        )}
                        <AppointmentTypeBadge type={a.type as AppointmentType} />
                        {/* #377 — Ameliyat hastasının ölçümü güncel değil → ölçüme yönlendir. */}
                        {a.type === 'surgery' && a.measurementStale && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-1.5 py-0.5 text-[10px] font-medium text-warning-foreground">
                            <AlertCircle className="h-3 w-3" aria-hidden />
                            {t('receptionQueue:cockpit.measurementStale', {
                              defaultValue: 'Ölçüm güncel değil',
                            })}
                          </span>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="touch"
                        data-testid="cockpit-arrive"
                        disabled={checkIn.isPending || a.status === 'checked_in'}
                        onClick={() => doCheckIn(a)}
                      >
                        {t('receptionQueue:cockpit.arriveCta')}
                      </Button>
                      {a.status !== 'checked_in' &&
                        isMeasurementDefaultCheckin(a.type as AppointmentType) && (
                          <Button
                            size="touch"
                            variant="outline"
                            data-testid="cockpit-arrive-doctor"
                            disabled={checkIn.isPending}
                            title={t('receptionQueue:cockpit.arriveToDoctorHint')}
                            onClick={() => doCheckIn(a, 'examination')}
                          >
                            {t('receptionQueue:cockpit.arriveToDoctor')}
                          </Button>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Pane>

        <Pane
          icon={<AlertCircle className="h-4 w-4" />}
          title={t('receptionQueue:cockpit.pending')}
          count={queueRows.length}
          loading={queue.isLoading}
          empty={queueRows.length === 0 ? t('receptionQueue:cockpit.pendingEmpty') : null}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('receptionQueue:cockpit.colPatient')}</TableHead>
                <TableHead>{t('receptionQueue:cockpit.colStage')}</TableHead>
                <TableHead className="text-right">
                  {t('receptionQueue:cockpit.colAction')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queueRows.map((row) => {
                const meta = ENCOUNTER_STAGE_META[row.stage];
                const Icon = meta.icon;
                const isExam = row.stage === 'awaiting_exam_payment';
                const paid = row.hasPaidSession;
                const unpaidHint = isExam
                  ? t('receptionQueue:error.examUnpaid')
                  : t('receptionQueue:error.measurementUnpaid');
                return (
                  <TableRow key={row.id} data-testid="reception-queue-row">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          {row.patient.firstName} {row.patient.lastName}
                          {/* #424 — Acil triyaj rozeti (kuyruk en üstte). */}
                          {row.isUrgent && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-critical-border bg-critical-bg px-2 py-0.5 text-[10px] font-semibold text-critical-foreground">
                              <AlertCircle className="h-3 w-3" aria-hidden />
                              {t('receptionQueue:cockpit.urgent', { defaultValue: 'ACİL' })}
                            </span>
                          )}
                          {(row.patient.tags ?? []).includes('vip') && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning-foreground">
                              <Star className="h-3 w-3 fill-current" aria-hidden /> VIP
                            </span>
                          )}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {row.patient.mrn}
                        </span>
                        {/* #424 — Acil işaretle/kaldır (triyaj). */}
                        <button
                          type="button"
                          disabled={setUrgent.isPending}
                          onClick={() => setUrgent.mutate({ id: row.id, isUrgent: !row.isUrgent })}
                          className="mt-0.5 inline-flex w-fit items-center gap-1 text-[10px] text-muted-foreground hover:text-critical-foreground disabled:opacity-50"
                        >
                          <AlertCircle className="h-3 w-3" aria-hidden />
                          {row.isUrgent
                            ? t('receptionQueue:cockpit.urgentClear', {
                                defaultValue: 'Acil kaldır',
                              })
                            : t('receptionQueue:cockpit.urgentSet', {
                                defaultValue: 'Acil işaretle',
                              })}
                        </button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs',
                          meta.badge,
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                        {t(`worklist:${meta.labelKey}`)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-2">
                        {/* #395 — Tahsilat alındıysa (hasPaidSession) "Hızlı tahsil" gizlenir
                            (ikinci fatura riski biter); değilse birincil kalır. "Gönder"
                            ödenmeden disabled + tooltip (S12c kapısı UI'da da görünür). */}
                        {paid ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
                            <CheckCircle2 className="h-3 w-3" aria-hidden />
                            {t('receptionQueue:cockpit.paidBadge')}
                          </span>
                        ) : (
                          <Button
                            size="touch"
                            variant="default"
                            data-testid="cockpit-quick-charge"
                            onClick={() =>
                              setChain({
                                kind: 'invoice',
                                patientId: row.patient.id,
                                patientName: `${row.patient.firstName} ${row.patient.lastName}`,
                              })
                            }
                          >
                            <Receipt className="mr-1 h-3.5 w-3.5" />
                            {t('receptionQueue:cockpit.quickChargeCta')}
                          </Button>
                        )}
                        <span title={paid ? undefined : unpaidHint}>
                          <Button
                            size="touch"
                            variant={paid ? 'default' : 'outline'}
                            disabled={advance.isPending || !paid}
                            data-testid={isExam ? 'send-to-doctor' : 'send-to-measurement'}
                            onClick={() =>
                              advance.mutate({
                                id: row.id,
                                toStage: isExam ? 'waiting_doctor' : 'in_measurement',
                              })
                            }
                          >
                            <ArrowRight className="mr-1 h-3.5 w-3.5" />
                            {isExam
                              ? t('receptionQueue:action.sendToDoctor')
                              : t('receptionQueue:action.sendToMeasurement')}
                          </Button>
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Pane>

        <Pane
          icon={<CheckCircle2 className="h-4 w-4" />}
          title={t('receptionQueue:cockpit.completed')}
          count={completedRows.length}
          loading={completed.isLoading}
          empty={completedRows.length === 0 ? t('receptionQueue:cockpit.completedEmpty') : null}
        >
          <ul className="divide-y divide-border">
            {completedRows.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium">
                    {a.patient.firstName} {a.patient.lastName}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {a.patient.mrn} • {a.doctor.name}
                  </span>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {timeFmt.format(new Date(a.startsAt))}
                </span>
              </li>
            ))}
          </ul>
        </Pane>
      </div>

      {chain.kind === 'invoice' && (
        <InvoiceCreateDialog
          patientId={chain.patientId}
          appointmentId={chain.appointmentId}
          appointmentType={chain.appointmentType}
          onClose={closeChain}
          onCreated={onInvoiceCreated}
        />
      )}
      {chain.kind === 'payment' && (
        <PaymentDialog
          invoiceId={chain.invoiceId}
          invoiceCurrency={chain.currency}
          openBalance={chain.openBalance}
          onClose={closeChain}
          onSuccess={closeChain}
          onPaid={onPaid}
        />
      )}
    </div>
  );
}

interface PaneProps {
  icon: React.ReactNode;
  title: string;
  count: number;
  loading: boolean;
  empty: string | null;
  children: React.ReactNode;
}

function Pane({ icon, title, count, loading, empty, children }: PaneProps) {
  return (
    <section className="flex flex-col rounded-lg border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {count}
        </span>
      </header>
      <div className="min-h-[160px] p-2">
        {loading && (
          <div className="space-y-2 p-2" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 rounded bg-muted" />
            ))}
          </div>
        )}
        {!loading && empty ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
