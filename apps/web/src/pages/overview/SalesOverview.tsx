import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, Scissors, CalendarClock, PhoneCall, AlertTriangle } from 'lucide-react';
import { OverviewShell, OverviewStatCard } from '../../components/overview';
import { WidgetShell } from '../../components/dashboard/WidgetShell';
import { trpc } from '../../lib/trpc';

/**
 * Ameliyat Satış Genel Bakış — devir kuyruğu odaklı. v0.4.2 R6 (#728). Gerçek veri (anti-AI).
 * Operasyonel home base Satış Hattı (/surgery-sales); bu pinned hızlı-erişim:
 * devir bekleyen / bugün ameliyat / yaklaşan 7g + devir/yaklaşan/recall widget.
 */

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}
function isSameDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}
function weekRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setDate(end.getDate() + 7);
  end.setHours(23, 59, 59, 999);
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

export function SalesOverview() {
  const { t } = useTranslation(['common', 'clinical']);
  const range = useMemo(weekRange, []);

  const pipeline = trpc.surgery.salesPipeline.useQuery(undefined, { refetchInterval: 30_000 });
  const upcoming = trpc.surgery.list.useQuery(
    { dateFrom: range.dateFrom, dateTo: range.dateTo, page: 1, pageSize: 100 },
    { refetchInterval: 60_000 },
  );
  const recall = trpc.recall.list.useQuery({ bucket: 'missed' }, { refetchInterval: 60_000 });

  const pipelineRows = pipeline.data ?? [];
  const handoffCount = pipelineRows.length;
  const upcomingRows = upcoming.data?.items ?? [];
  const today = new Date();
  const todayCount = upcomingRows.filter((s) => isSameDay(s.scheduledAt, today)).length;
  const weekCount = upcomingRows.length;
  const recallRows = recall.data ?? [];
  // R6 (#728) — risk: yaklaşan planlı ameliyat ama hazırlık eksik — imzalı onam
  // yok (satışta uyar; "imzasız ameliyat tamamlanamaz") VEYA ödeme tamamlanmamış
  // (cerrahiye bağlı paid/partial fatura yok). Her satırda eksik(ler) etiketlenir.
  const riskRows = upcomingRows
    .filter((s) => s.status === 'planned')
    .map((s) => {
      const r = s as { consentSigned?: boolean; paymentComplete?: boolean };
      return { s, consentMissing: !r.consentSigned, paymentMissing: !r.paymentComplete };
    })
    .filter((r) => r.consentMissing || r.paymentMissing);

  return (
    <OverviewShell title={t('overview.sales.title')}>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewStatCard
          icon={ArrowRightLeft}
          tint="sky"
          value={pipeline.isLoading ? '—' : handoffCount}
          label={t('overview.sales.kpiHandoff')}
          to="/surgery-sales"
          badge={
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-600">
              {t('overview.sales.live')}
            </span>
          }
        />
        <OverviewStatCard
          icon={Scissors}
          tint="blue"
          value={upcoming.isLoading ? '—' : todayCount}
          label={t('overview.sales.kpiToday')}
          to="/surgery-calendar"
        />
        <OverviewStatCard
          icon={CalendarClock}
          tint="violet"
          value={upcoming.isLoading ? '—' : weekCount}
          label={t('overview.sales.kpiWeek')}
          to="/surgery-calendar"
        />
        <OverviewStatCard
          icon={PhoneCall}
          tint="amber"
          value={recall.isLoading ? '—' : recallRows.length}
          label={t('overview.sales.kpiRecall')}
          to="/recall"
        />
      </section>

      {riskRows.length > 0 && (
        <section
          className="rounded-xl border border-rose-300 bg-rose-50/60 p-4"
          data-testid="sales-prep-risk"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-rose-800">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {t('overview.sales.riskPrepTitle', {
              count: riskRows.length,
              defaultValue: `Hazırlığı eksik yaklaşan ameliyat: ${riskRows.length}`,
            })}
          </div>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {riskRows.slice(0, 6).map(({ s, consentMissing, paymentMissing }) => (
              <li key={s.id}>
                <Link
                  to="/surgery-calendar"
                  className="flex items-center gap-2 rounded-md bg-background/70 px-2 py-1.5 text-sm hover:bg-background"
                >
                  <span className="w-10 shrink-0 tabular-nums text-xs text-muted-foreground">
                    {fmtDate(s.scheduledAt)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {s.patient.firstName} {s.patient.lastName}
                  </span>
                  {consentMissing && (
                    <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                      {t('overview.sales.tagConsent', { defaultValue: 'onam' })}
                    </span>
                  )}
                  {paymentMissing && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      {t('overview.sales.tagPayment', { defaultValue: 'ödeme' })}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-3">
        <WidgetShell
          title={t('overview.sales.widgetHandoff')}
          icon={<ArrowRightLeft className="h-4 w-4" />}
          loading={pipeline.isLoading}
          error={pipeline.error ? { message: t('overview.sales.loadError') } : null}
          empty={!pipeline.isLoading && handoffCount === 0}
          emptyLabel={t('overview.sales.emptyHandoff')}
        >
          <ul className="space-y-1">
            {pipelineRows.slice(0, 6).map((r) => (
              <li key={r.id}>
                <Link
                  to="/surgery-sales"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {r.patient.firstName} {r.patient.lastName}
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                      {r.patient.mrn}
                    </span>
                  </span>
                  {!r.eyeSide ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-rose-600">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      {t('overview.sales.eyeMissing')}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {t(`clinical:eyeSide.${r.eyeSide}`)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>

        <WidgetShell
          title={t('overview.sales.widgetUpcoming')}
          icon={<CalendarClock className="h-4 w-4" />}
          loading={upcoming.isLoading}
          error={upcoming.error ? { message: t('overview.sales.loadError') } : null}
          empty={!upcoming.isLoading && weekCount === 0}
          emptyLabel={t('overview.sales.emptyUpcoming')}
        >
          <ul className="space-y-1">
            {upcomingRows.slice(0, 6).map((s) => (
              <li key={s.id}>
                <Link
                  to="/surgery-calendar"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">
                    {fmtDate(s.scheduledAt)}
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

        <WidgetShell
          title={t('overview.sales.widgetRecall')}
          icon={<PhoneCall className="h-4 w-4" />}
          loading={recall.isLoading}
          error={recall.error ? { message: t('overview.sales.loadError') } : null}
          empty={!recall.isLoading && recallRows.length === 0}
          emptyLabel={t('overview.sales.emptyRecall')}
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
      </section>
    </OverviewShell>
  );
}
