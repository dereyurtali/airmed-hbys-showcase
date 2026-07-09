import { localeToIntl } from '../lib/i18n-format';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { trpc } from '../lib/trpc';
import { useLocale } from '../providers/LocaleProvider';
import { DataErrorState } from '../components/common/DataErrorState';
import { DateField } from '../components/ui/date-field';
import { Badge } from '../components/ui/badge';

const STATUS_VARIANT: Record<string, 'info' | 'success' | 'warning' | 'neutral' | 'critical'> = {
  planned: 'info',
  performed: 'success',
  postponed: 'warning',
  cancelled: 'neutral',
  refused: 'critical',
};

const HORIZON_DAYS = 90;

interface SurgeryRow {
  id: string;
  type: string;
  status: string;
  scheduledAt: string;
  eyeSide: 'od' | 'os' | 'ou' | null;
  patient: { id: string; mrn: string; firstName: string; lastName: string };
  doctor: { id: string; name: string } | null;
  // R6 (#728) — surgery.list her satıra onam + ödeme durumu döner (quick-filter).
  consentSigned: boolean;
  paymentComplete: boolean;
}

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * S16 — Ameliyat Takvimi: ameliyat satışın salt-okunur planlı-ameliyat görünümü,
 * güne göre gruplu. Tarih aralığı (from/to) + hasta adı araması ile filtrelenir.
 */
export function SurgeryCalendarPage() {
  const { t } = useTranslation(['surgerySales', 'surgery']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [from, setFrom] = useState(() => toDateInput(today));
  const [to, setTo] = useState(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + HORIZON_DAYS);
    return toDateInput(d);
  });
  const [search, setSearch] = useState('');
  // R6 (#728) — "onamı eksik" quick-filter (satış öncesi risk).
  const [consentOnly, setConsentOnly] = useState(false);
  const [paymentOnly, setPaymentOnly] = useState(false);

  // Tarih aralığı → query. dateTo = seçilen günün SONU (ertesi gün başı, lt).
  const range = useMemo(() => {
    const dateFrom = new Date(`${from}T00:00:00`).toISOString();
    const toEnd = new Date(`${to}T00:00:00`);
    toEnd.setDate(toEnd.getDate() + 1);
    return { dateFrom, dateTo: toEnd.toISOString() };
  }, [from, to]);

  const list = trpc.surgery.list.useQuery({ ...range, page: 1, pageSize: 200 });
  const allItems = (list.data?.items ?? []) as unknown as SurgeryRow[];

  // İsim araması (client-side, yüklenen aralık içinde).
  const q = search.trim().toLocaleLowerCase(dateLocale);
  const items = allItems
    .filter(
      (s) =>
        !q ||
        `${s.patient.firstName} ${s.patient.lastName} ${s.patient.mrn}`
          .toLocaleLowerCase(dateLocale)
          .includes(q),
    )
    .filter((s) => !consentOnly || !s.consentSigned)
    .filter((s) => !paymentOnly || !s.paymentComplete);

  // Güne göre grupla, artan (en yakın gün üstte) sırada.
  const groups = useMemo(() => {
    const byDay = new Map<string, SurgeryRow[]>();
    for (const s of [...items].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
      const key = s.scheduledAt.slice(0, 10);
      (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(s);
    }
    return [...byDay.entries()];
  }, [items]);

  const fmtDay = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(dateLocale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' });
  const dateLabel = new Date().toLocaleDateString(dateLocale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('calendar.title')}</h1>
          <p className="text-sm capitalize text-muted-foreground">{dateLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateField value={from} onChange={setFrom} aria-label={t('calendar.dateFrom')} />
          <span className="text-muted-foreground">–</span>
          <DateField value={to} onChange={setTo} aria-label={t('calendar.dateTo')} />
          <div className="relative w-full max-w-[14rem]">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('calendar.searchPlaceholder')}
              className="h-10 w-full rounded-full border border-input bg-muted/40 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <button
            type="button"
            onClick={() => setConsentOnly((v) => !v)}
            aria-pressed={consentOnly}
            data-testid="calendar-consent-filter"
            className={cn(
              'h-10 rounded-full border px-4 text-sm font-medium transition-colors',
              consentOnly
                ? 'border-critical-border bg-critical-bg text-critical-foreground'
                : 'border-input text-muted-foreground hover:bg-muted',
            )}
          >
            {t('calendar.consentMissingFilter', { defaultValue: 'Onamı eksik' })}
          </button>
          <button
            type="button"
            onClick={() => setPaymentOnly((v) => !v)}
            aria-pressed={paymentOnly}
            data-testid="calendar-payment-filter"
            className={cn(
              'h-10 rounded-full border px-4 text-sm font-medium transition-colors',
              paymentOnly
                ? 'border-warning-border bg-warning-bg text-warning-foreground'
                : 'border-input text-muted-foreground hover:bg-muted',
            )}
          >
            {t('calendar.paymentMissingFilter', { defaultValue: 'Ödemesi eksik' })}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {list.isError && !list.data && <DataErrorState onRetry={() => list.refetch()} />}

        {list.isLoading && <div className="h-24 rounded-lg bg-muted" />}

        {list.data && groups.length === 0 && (
          <div className="rounded-lg border bg-background py-16 text-center text-sm text-muted-foreground">
            {q ? t('calendar.noResults', { query: search.trim() }) : t('calendar.empty')}
          </div>
        )}

        {groups.map(([day, surgeries]) => (
          <section key={day} className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold capitalize text-muted-foreground">
              <CalendarDays className="h-4 w-4" aria-hidden />
              {fmtDay(day)}
            </h2>
            <div className="overflow-hidden rounded-lg border bg-background">
              {surgeries.map((s, idx) => (
                <Link
                  key={s.id}
                  to={`/patients/${s.patient.id}`}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50',
                    idx > 0 && 'border-t',
                  )}
                >
                  <span className="w-12 shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                    {fmtTime(s.scheduledAt)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {s.patient.firstName} {s.patient.lastName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.type}
                      {s.eyeSide && ` · ${s.eyeSide.toUpperCase()}`}
                      {s.doctor && ` · ${s.doctor.name}`}
                    </span>
                  </span>
                  {!s.consentSigned && s.status === 'planned' && (
                    <Badge variant="critical" className="shrink-0">
                      {t('calendar.consentMissing', { defaultValue: 'Onam eksik' })}
                    </Badge>
                  )}
                  {!s.paymentComplete && s.status === 'planned' && (
                    <Badge variant="warning" className="shrink-0">
                      {t('calendar.paymentMissing', { defaultValue: 'Ödeme eksik' })}
                    </Badge>
                  )}
                  <Badge variant={STATUS_VARIANT[s.status] ?? 'neutral'} className="shrink-0">
                    {t(`surgery:status.${s.status}`)}
                  </Badge>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
