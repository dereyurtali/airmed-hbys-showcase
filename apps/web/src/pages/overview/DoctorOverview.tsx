import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Stethoscope, CalendarDays, FileSignature, Scissors, AlertTriangle } from 'lucide-react';
import { OverviewShell, OverviewStatCard } from '../../components/overview';
import { WidgetShell } from '../../components/dashboard/WidgetShell';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../providers/AuthProvider';
import { trpc } from '../../lib/trpc';

/**
 * Doktor Genel Bakış — "Bugünkü Programım" (Misafir: "Bugünkü Listem"). v0.4.2 R1 (#723).
 * Gerçek veri (anti-AI): hepsi doktora-scoped/bugün. Tek dominant primary worklist'ten türer
 * (aktif in_exam → Devam / yoksa Sıradaki; 3/3 → disabled+sebep). KPI'lar tıkla→ön-filtreli route.
 */

const ALLERGY_TAGS = new Set([
  'allergy',
  'drug_allergy',
  'latex_allergy',
  'iodine_allergy',
  'penicillin_allergy',
]);

function hasAllergy(tags?: string[] | null): boolean {
  return (tags ?? []).some((tg) => ALLERGY_TAGS.has(tg));
}

function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

export function DoctorOverview() {
  const { t } = useTranslation(['common', 'clinical']);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isVisiting = user?.flags?.is_visiting_doctor === true;

  const range = useMemo(todayRange, []);
  // #1066 — 4 bağımsız 60sn poll yerine tek agregat sorgu + tek timer
  // (dashboard.doctorOverview; sidebar'ın myWorklist timer'ı ayrı kalır → ≤2).
  const overview = trpc.dashboard.doctorOverview.useQuery(range, { refetchInterval: 60_000 });

  const rows = overview.data?.worklist ?? [];
  const inExam = rows.filter((r) => r.stage === 'in_exam').length;
  const waiting = rows.filter((r) => r.stage === 'waiting_doctor').length;
  const queueCount = rows.length;
  const apptCount = overview.data?.appointments.length ?? 0;
  const cosignList = overview.data?.cosignPending ?? [];
  const cosignCount = cosignList.length;
  const surgeryList = overview.data?.surgeries.items ?? [];
  const surgeryCount = surgeryList.length;

  // Tek dominant primary — worklist'ten türer.
  const capReached = inExam >= 3;
  const continuing = inExam > 0;
  const canTakeNext = waiting > 0 && !capReached;
  const primaryEnabled = continuing || canTakeNext;
  const primaryLabel = continuing
    ? t('overview.doctor.continueExam')
    : t('overview.doctor.takeNext');
  const primaryReason = capReached
    ? t('overview.doctor.capReached')
    : !primaryEnabled
      ? t('overview.doctor.queueEmpty')
      : undefined;

  const title = isVisiting
    ? t('overview.doctor.titleVisiting')
    : t('overview.doctor.titleResident');

  return (
    <OverviewShell
      title={title}
      actions={
        <div className="flex flex-col items-end gap-1">
          <Button
            size="lg"
            disabled={!primaryEnabled}
            title={primaryReason}
            onClick={() => navigate('/worklist')}
            data-testid="doctor-overview-primary"
          >
            <Stethoscope className="mr-2 h-4 w-4" aria-hidden />
            {primaryLabel}
          </Button>
          {primaryReason && <span className="text-xs text-muted-foreground">{primaryReason}</span>}
        </div>
      }
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewStatCard
          icon={Stethoscope}
          tint="sky"
          value={overview.isLoading ? '—' : queueCount}
          label={t('overview.doctor.kpiQueue')}
          to="/worklist"
          badge={
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-600">
              {t('overview.doctor.live')}
            </span>
          }
        />
        <OverviewStatCard
          icon={CalendarDays}
          tint="blue"
          value={overview.isLoading ? '—' : apptCount}
          label={t('overview.doctor.kpiAppointments')}
          to="/schedule"
        />
        <OverviewStatCard
          icon={FileSignature}
          tint="violet"
          value={overview.isLoading ? '—' : cosignCount}
          label={t('overview.doctor.kpiCosign')}
          to="/cosign"
        />
        <OverviewStatCard
          icon={Scissors}
          tint="amber"
          value={overview.isLoading ? '—' : surgeryCount}
          label={t('overview.doctor.kpiSurgery')}
          to="/surgery-day"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <WidgetShell
          title={t('overview.doctor.widgetQueue')}
          icon={<Stethoscope className="h-4 w-4" />}
          loading={overview.isLoading}
          error={overview.error ? { message: t('overview.doctor.loadError') } : null}
          empty={!overview.isLoading && queueCount === 0}
          emptyLabel={t('overview.doctor.emptyQueue')}
        >
          <ul className="space-y-1">
            {rows.slice(0, 6).map((r) => (
              <li key={r.id}>
                <Link
                  to="/worklist"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">
                    {fmtTime(r.appointment?.startsAt ?? r.stageUpdatedAt)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {r.patient.firstName} {r.patient.lastName}
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                      {r.patient.mrn}
                    </span>
                  </span>
                  {hasAllergy(r.patient.tags) && (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>

        <WidgetShell
          title={t('overview.doctor.widgetCosign')}
          icon={<FileSignature className="h-4 w-4" />}
          loading={overview.isLoading}
          error={overview.error ? { message: t('overview.doctor.loadError') } : null}
          empty={!overview.isLoading && cosignCount === 0}
          emptyLabel={t('overview.doctor.emptyCosign')}
        >
          <ul className="space-y-1">
            {cosignList.slice(0, 6).map((c) => (
              <li key={c.id}>
                <Link to="/cosign" className="block rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <span className="block truncate">{c.patient?.name ?? c.summary ?? c.action}</span>
                  {c.summary && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.summary}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>

        <WidgetShell
          title={t('overview.doctor.widgetSurgery')}
          icon={<Scissors className="h-4 w-4" />}
          loading={overview.isLoading}
          error={overview.error ? { message: t('overview.doctor.loadError') } : null}
          empty={!overview.isLoading && surgeryCount === 0}
          emptyLabel={t('overview.doctor.emptySurgery')}
        >
          <ul className="space-y-1">
            {surgeryList.slice(0, 6).map((s) => (
              <li key={s.id}>
                <Link
                  to="/surgery-day"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">
                    {fmtTime(s.scheduledAt)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {s.patient.firstName} {s.patient.lastName}
                  </span>
                  {s.eyeSide && (
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {t(`clinical:eyeSide.${s.eyeSide}`)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>
      </section>
    </OverviewShell>
  );
}
