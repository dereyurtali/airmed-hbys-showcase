import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, PhoneCall, Scissors, ShieldCheck, UserCheck, Stethoscope } from 'lucide-react';
import { OverviewShell, OverviewStatCard } from '../../components/overview';
import { WidgetShell } from '../../components/dashboard/WidgetShell';
import { useAuth } from '../../providers/AuthProvider';
import { trpc } from '../../lib/trpc';

/**
 * Hemşire Genel Bakış — Genel modu (klinik görev odağı: ölçüm/recall/ameliyat güvenlik)
 * ve Asistan modu (Dr. X adına: doktor-scoped kuyruk). Ölçüm modu ayrı kiosk ekranıdır
 * (MeasurementKioskOverview). v0.4.2 R2 (#724). Gerçek veri (anti-AI).
 */

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

export function NurseOverview() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const isAsistan = user?.mode === 'asistan';
  const genel = !isAsistan;
  const range = useMemo(todayRange, []);

  // #1066 — poll tekilleştirme: ölçüm kuyruğu + worklist anahtarlarını
  // her-ekranda-canlı nurse-sidebar zaten 30sn'de poll'lüyor; bu sayfa aynı
  // cache'i interval'siz okur. Genel-mod geri kalanı tek agregat sorguda
  // (dashboard.nurseOverview) → ekran başına ≤2 timer.
  const measPending = trpc.measurementOrder.listForUnit.useQuery({});
  const agg = trpc.dashboard.nurseOverview.useQuery(range, {
    enabled: genel,
    refetchInterval: 60_000,
  });
  const session = trpc.nurseSession.my.useQuery(undefined, { enabled: isAsistan });
  const doctors = trpc.doctor.list.useQuery(
    { page: 1, pageSize: 200, isActive: true },
    { enabled: isAsistan, staleTime: 300_000 },
  );
  const worklist = trpc.encounter.myWorklist.useQuery({}, { enabled: isAsistan });

  const measCount = measPending.data?.length ?? 0;
  const recallMissedRows = agg.data?.recallMissed ?? [];
  const recallTodayRows = agg.data?.recallToday ?? [];
  const recallCount = recallMissedRows.length + recallTodayRows.length;
  const surgeryList = agg.data?.surgeries.items ?? [];
  const surgeryCount = surgeryList.length;
  const safetyIncomplete = surgeryList.filter((s) => !s.safetyFullyComplete).length;

  if (isAsistan) {
    const activeDoctorUserId = session.data?.doctorUserId;
    const actingName = activeDoctorUserId
      ? (doctors.data?.items.find((d) => d.userId === activeDoctorUserId)?.name ??
        t('overview.nurse.unknownDoctor'))
      : null;
    const wlRows = worklist.data ?? [];

    return (
      <OverviewShell title={t('overview.nurse.titleAssistant')}>
        {actingName && (
          <div
            className="flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900"
            data-testid="nurse-acting-banner"
          >
            <UserCheck className="h-4 w-4 shrink-0" aria-hidden />
            <span>
              {t('overview.nurse.actingFor')} <strong>{actingName}</strong>
            </span>
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <OverviewStatCard
            icon={Stethoscope}
            tint="sky"
            value={worklist.isLoading ? '—' : wlRows.length}
            label={t('overview.nurse.kpiMyQueue')}
            to="/worklist"
          />
          <OverviewStatCard
            icon={Activity}
            tint="violet"
            value={measPending.isLoading ? '—' : measCount}
            label={t('overview.nurse.kpiMeasPending')}
            to="/measurement-queue"
          />
        </section>

        <WidgetShell
          title={t('overview.nurse.widgetMyQueue')}
          icon={<Stethoscope className="h-4 w-4" />}
          loading={worklist.isLoading}
          error={worklist.error ? { message: t('overview.nurse.loadError') } : null}
          empty={!worklist.isLoading && wlRows.length === 0}
          emptyLabel={t('overview.nurse.emptyMyQueue')}
        >
          <ul className="space-y-1">
            {wlRows.slice(0, 8).map((r) => (
              <li key={r.id}>
                <Link
                  to="/worklist"
                  className="block truncate rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  {r.patient.firstName} {r.patient.lastName}
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                    {r.patient.mrn}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>
      </OverviewShell>
    );
  }

  // Genel mod
  return (
    <OverviewShell title={t('overview.nurse.titleGeneral')}>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewStatCard
          icon={Activity}
          tint="sky"
          value={measPending.isLoading ? '—' : measCount}
          label={t('overview.nurse.kpiMeasPending')}
          to="/measurement-queue"
        />
        <OverviewStatCard
          icon={PhoneCall}
          tint="amber"
          value={agg.isLoading ? '—' : recallCount}
          label={t('overview.nurse.kpiRecall')}
          to="/recall"
        />
        <OverviewStatCard
          icon={Scissors}
          tint="blue"
          value={agg.isLoading ? '—' : surgeryCount}
          label={t('overview.nurse.kpiSurgery')}
          to="/surgery-day"
        />
        <OverviewStatCard
          icon={ShieldCheck}
          tint={safetyIncomplete > 0 ? 'rose' : 'emerald'}
          value={agg.isLoading ? '—' : safetyIncomplete}
          label={t('overview.nurse.kpiSafety')}
          to="/surgery-day"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <WidgetShell
          title={t('overview.nurse.widgetMeas')}
          icon={<Activity className="h-4 w-4" />}
          loading={measPending.isLoading}
          error={measPending.error ? { message: t('overview.nurse.loadError') } : null}
          empty={!measPending.isLoading && measCount === 0}
          emptyLabel={t('overview.nurse.emptyMeas')}
        >
          <ul className="space-y-1">
            {(measPending.data ?? []).slice(0, 6).map((o) => (
              <li key={o.id}>
                <Link
                  to="/measurement-queue"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {o.patient.firstName} {o.patient.lastName}
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                      {o.patient.mrn}
                    </span>
                  </span>
                  {o.requiresPayment && (
                    <span className="shrink-0 text-xs text-amber-600">
                      {t('overview.nurse.paymentGate')}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>

        <WidgetShell
          title={t('overview.nurse.widgetRecall')}
          icon={<PhoneCall className="h-4 w-4" />}
          loading={agg.isLoading}
          error={agg.error ? { message: t('overview.nurse.loadError') } : null}
          empty={!agg.isLoading && recallMissedRows.length === 0}
          emptyLabel={t('overview.nurse.emptyRecall')}
        >
          <ul className="space-y-1">
            {recallMissedRows.slice(0, 6).map((r) => (
              <li key={r.id}>
                <Link
                  to="/recall"
                  className="block truncate rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  {r.patient.firstName} {r.patient.lastName}
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                    {r.patient.mrn}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>

        <WidgetShell
          title={t('overview.nurse.widgetSafety')}
          icon={<ShieldCheck className="h-4 w-4" />}
          loading={agg.isLoading}
          error={agg.error ? { message: t('overview.nurse.loadError') } : null}
          empty={!agg.isLoading && surgeryCount === 0}
          emptyLabel={t('overview.nurse.emptySurgery')}
        >
          <ul className="space-y-1">
            {surgeryList.slice(0, 6).map((s) => (
              <li key={s.id}>
                <Link
                  to="/surgery-day"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {s.patient.firstName} {s.patient.lastName}
                  </span>
                  <span
                    className={
                      'shrink-0 text-xs font-medium ' +
                      (s.safetyFullyComplete ? 'text-emerald-600' : 'text-rose-600')
                    }
                  >
                    {s.safetyFullyComplete
                      ? t('overview.nurse.safetyOk')
                      : t('overview.nurse.safetyIncomplete')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>
      </section>
    </OverviewShell>
  );
}
