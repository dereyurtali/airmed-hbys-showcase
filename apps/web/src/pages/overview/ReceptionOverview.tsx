import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  ClipboardCheck,
  CheckCircle2,
  ShieldOff,
  PhoneCall,
  AlertTriangle,
} from 'lucide-react';
import { OverviewShell, OverviewStatCard, SystemStatusStrip } from '../../components/overview';
import { WidgetShell } from '../../components/dashboard/WidgetShell';
import { trpc } from '../../lib/trpc';
import { billingApi } from '../../lib/billing.trpc';

/**
 * Resepsiyon Genel Bakış — tek bakışta triage. v0.4.2 R3 (#725). Gerçek veri (anti-AI).
 * Operasyonel home base Karşılama kokpitidir (/reception-queue); bu pinned hızlı-erişim:
 * bugün randevu / karşılama kuyruğu / tamamlandı / "önce öde" ihlali + kuyruk/recall widget.
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
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

export function ReceptionOverview() {
  const { t } = useTranslation('common');
  const range = useMemo(todayRange, []);

  const appointments = trpc.appointment.findInRange.useQuery(range, { refetchInterval: 60_000 });
  const queue = trpc.encounter.receptionQueue.useQuery(undefined, { refetchInterval: 30_000 });
  const compliance = billingApi.compliancePulse.useQuery(undefined, { refetchInterval: 60_000 });
  const recall = trpc.recall.list.useQuery({ bucket: 'missed' }, { refetchInterval: 60_000 });

  const appts = appointments.data ?? [];
  const apptCount = appts.length;
  const completedCount = appts.filter((a) => a.status === 'completed').length;
  const queueRows = queue.data ?? [];
  const queueCount = queueRows.length;
  const unpaidCount = compliance.data?.activeUnpaidEncounters.length ?? 0;
  const recallRows = recall.data ?? [];

  const sortedAppts = [...appts].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <OverviewShell title={t('overview.reception.title')}>
      <SystemStatusStrip />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewStatCard
          icon={CalendarDays}
          tint="blue"
          value={appointments.isLoading ? '—' : apptCount}
          label={t('overview.reception.kpiAppointments')}
          to="/schedule"
        />
        <OverviewStatCard
          icon={ClipboardCheck}
          tint="sky"
          value={queue.isLoading ? '—' : queueCount}
          label={t('overview.reception.kpiQueue')}
          to="/reception-queue"
          badge={
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-600">
              {t('overview.reception.live')}
            </span>
          }
        />
        <OverviewStatCard
          icon={CheckCircle2}
          tint="emerald"
          value={appointments.isLoading ? '—' : completedCount}
          label={t('overview.reception.kpiCompleted')}
          to="/reception-queue"
        />
        <OverviewStatCard
          icon={ShieldOff}
          tint={unpaidCount > 0 ? 'rose' : 'emerald'}
          value={compliance.isLoading ? '—' : unpaidCount}
          label={t('overview.reception.kpiUnpaid')}
          to="/reception-queue"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <WidgetShell
          title={t('overview.reception.widgetQueue')}
          icon={<ClipboardCheck className="h-4 w-4" />}
          loading={queue.isLoading}
          error={queue.error ? { message: t('overview.reception.loadError') } : null}
          empty={!queue.isLoading && queueCount === 0}
          emptyLabel={t('overview.reception.emptyQueue')}
        >
          <ul className="space-y-1">
            {queueRows.slice(0, 6).map((r) => (
              <li key={r.id}>
                <Link
                  to="/reception-queue"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
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
          title={t('overview.reception.widgetRecall')}
          icon={<PhoneCall className="h-4 w-4" />}
          loading={recall.isLoading}
          error={recall.error ? { message: t('overview.reception.loadError') } : null}
          empty={!recall.isLoading && recallRows.length === 0}
          emptyLabel={t('overview.reception.emptyRecall')}
        >
          <ul className="space-y-1">
            {recallRows.slice(0, 6).map((r) => (
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
          title={t('overview.reception.widgetAppointments')}
          icon={<CalendarDays className="h-4 w-4" />}
          loading={appointments.isLoading}
          error={appointments.error ? { message: t('overview.reception.loadError') } : null}
          empty={!appointments.isLoading && apptCount === 0}
          emptyLabel={t('overview.reception.emptyAppointments')}
        >
          <ul className="space-y-1">
            {sortedAppts.slice(0, 6).map((a) => (
              <li key={a.id}>
                <Link
                  to="/schedule"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">
                    {fmtTime(a.startsAt)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {a.patient.firstName} {a.patient.lastName}
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
