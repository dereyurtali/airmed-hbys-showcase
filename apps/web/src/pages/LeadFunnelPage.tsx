import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { DateField } from '../components/ui/date-field';
import type { LeadSource } from '../lib/patient.schemas';
import { trpc } from '../lib/trpc';
import { useLocale } from '../providers/LocaleProvider';
import { formatDate } from '../lib/i18n-format';

type Stage = 'lead' | 'appointment' | 'examination' | 'surgery' | 'surgery_refused';

export function LeadFunnelPage() {
  const { t } = useTranslation(['patient', 'common']);
  const { locale } = useLocale();
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [drill, setDrill] = useState<{ source: LeadSource | 'unset' | null; stage: Stage } | null>(
    null,
  );

  const funnel = trpc.lead.funnel.useQuery({
    from: from || undefined,
    to: to || undefined,
  });

  const drillSource = drill?.source;
  const drillStage = drill?.stage ?? 'lead';
  const list = trpc.lead.list.useQuery(
    {
      source: drillSource === 'unset' ? null : (drillSource ?? undefined),
      stage: drillStage,
      from: from || undefined,
      to: to || undefined,
      page: 1,
      pageSize: 100,
    },
    { enabled: !!drill },
  );

  const totals = useMemo(() => {
    const rows = funnel.data ?? [];
    return rows.reduce(
      (acc, r) => {
        acc.leads += r.leads;
        acc.withAppointment += r.withAppointment;
        acc.withExamination += r.withExamination;
        acc.withSurgery += r.withSurgery;
        return acc;
      },
      { leads: 0, withAppointment: 0, withExamination: 0, withSurgery: 0 },
    );
  }, [funnel.data]);

  const sourceLabel = (src: LeadSource | 'unset') =>
    src === 'unset' ? t('patient:leadSource.unset') : t(`patient:leadSource.${src}`);

  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);

  const stageLabel = (s: Stage) => t(`patient:leadFunnel.stages.${s}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('patient:leadFunnel.title')}
        description={t('patient:leadFunnel.description')}
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('patient:leadFunnel.from')}
          </label>
          <DateField value={from} onChange={setFrom} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('patient:leadFunnel.to')}
          </label>
          <DateField value={to} onChange={setTo} />
        </div>
        <div className="flex items-end">
          <Button
            variant="outline"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            {t('patient:leadFunnel.clearFilter')}
          </Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-4">
        <Kpi label={stageLabel('lead')} value={totals.leads} />
        <Kpi
          label={stageLabel('appointment')}
          value={totals.withAppointment}
          ratio={pct(totals.withAppointment, totals.leads)}
        />
        <Kpi
          label={stageLabel('examination')}
          value={totals.withExamination}
          ratio={pct(totals.withExamination, totals.leads)}
        />
        <Kpi
          label={stageLabel('surgery')}
          value={totals.withSurgery}
          ratio={pct(totals.withSurgery, totals.leads)}
        />
      </section>

      {/* S15-PR16 — Cerrahi reddi quick filter */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">{t('patient:leadFunnel.quickFilter')}</span>
        <Button
          size="sm"
          variant={drill?.stage === 'surgery_refused' ? 'default' : 'outline'}
          onClick={() => setDrill({ source: null, stage: 'surgery_refused' })}
        >
          {stageLabel('surgery_refused')}
        </Button>
        {drill?.stage === 'surgery_refused' && (
          <Button size="sm" variant="ghost" onClick={() => setDrill(null)}>
            {t('patient:leadFunnel.clearFilter')}
          </Button>
        )}
      </div>

      <section className="rounded-lg border bg-background">
        <Table className="w-full text-sm">
          <TableHeader className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <TableRow>
              <TableHead className="px-4 py-2">{t('patient:leadFunnel.columns.source')}</TableHead>
              <TableHead className="px-4 py-2 text-right">{stageLabel('lead')}</TableHead>
              <TableHead className="px-4 py-2 text-right">{stageLabel('appointment')}</TableHead>
              <TableHead className="px-4 py-2 text-right">{stageLabel('examination')}</TableHead>
              <TableHead className="px-4 py-2 text-right">{stageLabel('surgery')}</TableHead>
              <TableHead className="px-4 py-2 text-right">
                {t('patient:leadFunnel.columns.conversion')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {funnel.isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            )}
            {funnel.data && funnel.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t('patient:leadFunnel.empty')}
                </TableCell>
              </TableRow>
            )}
            {funnel.data
              ?.slice()
              .sort((a, b) => b.leads - a.leads)
              .map((row) => (
                <TableRow key={row.source} className="border-b last:border-b-0 hover:bg-muted/50">
                  <TableCell className="px-4 py-2 font-medium">{sourceLabel(row.source)}</TableCell>
                  <Cell
                    n={row.leads}
                    onClick={() => setDrill({ source: row.source, stage: 'lead' })}
                  />
                  <Cell
                    n={row.withAppointment}
                    onClick={() => setDrill({ source: row.source, stage: 'appointment' })}
                  />
                  <Cell
                    n={row.withExamination}
                    onClick={() => setDrill({ source: row.source, stage: 'examination' })}
                  />
                  <Cell
                    n={row.withSurgery}
                    onClick={() => setDrill({ source: row.source, stage: 'surgery' })}
                  />
                  <TableCell className="px-4 py-2 text-right text-muted-foreground">
                    {pct(row.withSurgery, row.leads)}%
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </section>

      {drill && (
        <section className="rounded-md border bg-background">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="text-sm">
              <span className="font-medium">
                {drill.source ? sourceLabel(drill.source) : t('patient:leadFunnel.allSources')}
              </span>
              {' — '}
              <span className="text-muted-foreground">{stageLabel(drill.stage)}</span>
              {list.data && (
                <span className="ml-2 text-xs text-muted-foreground">({list.data.total})</span>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={() => setDrill(null)}>
              {t('common:actions.close')}
            </Button>
          </div>
          <div className="max-h-96 overflow-auto">
            {list.isLoading && (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
            {list.data && list.data.items.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t('patient:leadFunnel.empty')}
              </div>
            )}
            <ul className="divide-y">
              {list.data?.items.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div>
                    <Link to={`/patients/${p.id}`} className="font-medium hover:underline">
                      {p.firstName} {p.lastName}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">{p.mrn}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(p.createdAt, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({ label, value, ratio }: { label: string; value: number; ratio?: number }) {
  return (
    <div className="rounded-md border bg-background p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {ratio !== undefined && <p className="text-xs text-muted-foreground">{ratio}%</p>}
    </div>
  );
}

function Cell({ n, onClick }: { n: number; onClick: () => void }) {
  return (
    <TableCell className="px-4 py-2 text-right">
      <button
        type="button"
        onClick={onClick}
        disabled={n === 0}
        className="text-sm tabular-nums hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline"
      >
        {n}
      </button>
    </TableCell>
  );
}
