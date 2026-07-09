import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../lib/i18n-format';
import { cn } from '../../lib/utils';
import { trpc } from '../../lib/trpc';
import { useLocale } from '../../providers/LocaleProvider';
import { DataErrorState } from '../common/DataErrorState';

// #373 — Hasta detayında randevu geçmişi: "en son ne zaman geldi / kaç kez
// gelmedi (no_show)" tek ekrandan. Soft-delete'liler hariç (service deletedAt
// filtreli); terminal durumlar (cancelled/no_show) dahil görünür.

interface Props {
  patientId: string;
}

// DB snake_case status → appointment:status.* camelCase anahtarı.
const STATUS_KEY: Record<string, string> = {
  scheduled: 'scheduled',
  checked_in: 'checkedIn',
  in_progress: 'inProgress',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'noShow',
};

const STATUS_COLOR: Record<string, string> = {
  scheduled: 'bg-info-bg text-info-foreground',
  checked_in: 'bg-warning-bg text-warning-foreground',
  in_progress: 'bg-info-bg text-info-foreground',
  completed: 'bg-success-bg text-success-foreground',
  cancelled: 'bg-[color:var(--neutral-tint)] text-muted-foreground',
  no_show: 'bg-critical-bg text-critical-foreground',
};

export function AppointmentHistorySection({ patientId }: Props) {
  const { t } = useTranslation(['appointment', 'common']);
  const { locale } = useLocale();

  const query = trpc.appointment.list.useQuery(
    { patientId, page: 1, pageSize: 50 },
    { enabled: !!patientId },
  );

  // Service `startsAt: 'asc'` döndürür; geçmiş için en yeni üstte.
  const items = [...(query.data?.items ?? [])].reverse();
  const total = query.data?.total ?? 0;
  const noShowCount = items.filter((a) => a.status === 'no_show').length;

  return (
    <section className="rounded-lg border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold">{t('appointment:history.title')}</h2>
        </div>
        {total > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {t('appointment:history.summary', { total, noShow: noShowCount })}
          </span>
        )}
      </div>

      <div className="p-2">
        {query.isLoading && <div className="h-16 rounded-md bg-muted" />}

        {query.isError && !query.data && (
          <DataErrorState
            onRetry={() => query.refetch()}
            message={t('appointment:history.loadError')}
          />
        )}

        {!query.isLoading && !query.isError && items.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {t('appointment:history.empty')}
          </p>
        )}

        {items.length > 0 && (
          <ul className="divide-y divide-border">
            {items.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm tabular-nums">{formatDate(a.startsAt, locale)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(`appointment:type.${a.type}`, { defaultValue: a.type })}
                  </span>
                </div>
                <span
                  className={cn(
                    'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                    STATUS_COLOR[a.status] ?? STATUS_COLOR.scheduled,
                  )}
                >
                  {t(`appointment:status.${STATUS_KEY[a.status] ?? a.status}`, {
                    defaultValue: a.status,
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
