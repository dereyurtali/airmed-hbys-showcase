import { localeToIntl } from '../lib/i18n-format';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ExternalLink,
  FileSignature,
  FileText,
  Loader2,
  Percent,
  Plus,
  Search,
  ShieldAlert,
  Stethoscope,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
import { DateTimeField } from '../components/ui/date-field';
import { cn } from '../lib/utils';
import { formatCurrency } from '../lib/commission.constants';
import {
  matchSurgeryServiceItem,
  SURGERY_CATALOG_CURRENCY,
  localizedServiceName,
} from '../lib/surgery-catalog';
import { billingApi, type ServiceItemRow } from '../lib/billing.trpc';
import { PaymentDialog } from '../components/billing/PaymentDialog';
import type { Currency } from '../lib/billing.constants';
import { trpc } from '../lib/trpc';
import { mapTrpcError } from '../lib/trpc-error';
import { useLocale } from '../providers/LocaleProvider';

type PipelineStatus = 'new' | 'price_given' | 'pending_approval' | 'scheduled';

const STATUS_META: Record<PipelineStatus, { labelKey: string; variant: 'warning' | 'info' }> = {
  new: { labelKey: 'pipeline.new', variant: 'warning' },
  price_given: { labelKey: 'pipeline.priceGiven', variant: 'info' },
  pending_approval: { labelKey: 'pipeline.pendingApproval', variant: 'warning' },
  scheduled: { labelKey: 'pipeline.scheduled', variant: 'info' },
};

interface PipelineRow {
  id: string;
  type: string;
  eyeSide: 'od' | 'os' | 'ou' | null;
  scheduledAt: string;
  createdAt: string;
  preOp: { notes?: string; lens?: string } | null;
  pipelineStatus: PipelineStatus;
  invoiceTotal: string | null;
  invoiceCurrency: string | null;
  patient: {
    id: string;
    mrn: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    phone: string | null;
  };
  doctor: { id: string; name: string; specialty: string } | null;
  // #370 — Satış temsilcisine salt-okunur klinik özet.
  clinicalSummary?: {
    diagnosis: string | null;
    examinedAt: string | null;
    measurementCount: number;
  };
}

function initials(first: string, last: string): string {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

function ageFrom(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length >= 6) return `${phone.slice(0, 4)} •• ${phone.slice(-2)}`;
  return phone;
}

// "Katarakt (Fako + Trifocal IOL)" → "Katarakt"; "Pterjium Eksizyonu" → aynı.
function surgeryName(type: string): string {
  const idx = type.indexOf('(');
  return (idx > 0 ? type.slice(0, idx) : type).trim();
}

// Lens tipini type string'inden türet (Monofokal / Trifokal / Torik / —).
function lensLabel(type: string): string {
  const t = type.toLocaleLowerCase('tr');
  if (t.includes('trifocal') || t.includes('trifokal')) return 'Trifokal';
  if (t.includes('toric') || t.includes('torik')) return 'Torik';
  if (t.includes('monofocal') || t.includes('monofokal')) return 'Monofokal';
  if (t.includes('refrakt')) return '—';
  return '—';
}

/**
 * S16 — Satış Hattı: ameliyat satışın iki-panel pipeline ekranı. Sol "Ameliyat
 * Adayları" (durum rozetli + fiyat), sağ detay: DOKTOR ÖNERİSİ (ameliyat/lens/
 * göz/öneren + klinik not) + katalog fiyatı + "Fiyatı Ver" (fatura + indirim).
 */
export function SurgerySalesQueuePage() {
  const { t } = useTranslation('surgerySales');
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';
  const utils = trpc.useUtils();

  const pipeline = trpc.surgery.salesPipeline.useQuery(undefined, { refetchInterval: 30_000 });
  const catalogQuery = billingApi.listServiceItems.useQuery({
    category: 'surgery',
    includeInactive: false,
  });
  const surgeryItems = catalogQuery.data ?? [];

  const rows = (pipeline.data ?? []) as unknown as PipelineRow[];
  const [search, setSearch] = useState('');
  const q = search.trim().toLocaleLowerCase(dateLocale);
  const filtered = q
    ? rows.filter((r) =>
        `${r.patient.firstName} ${r.patient.lastName} ${r.patient.mrn}`
          .toLocaleLowerCase(dateLocale)
          .includes(q),
      )
    : rows;

  const newCount = rows.filter((r) => r.pipelineStatus === 'new').length;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null;
  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedId !== null) setSelectedId(null);
    } else if (!filtered.some((r) => r.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' });
  const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
  const fmtWhen = (iso: string) =>
    isToday(iso)
      ? t('detail.today', { time: fmtTime(iso) })
      : `${new Date(iso).toLocaleDateString(dateLocale)} ${fmtTime(iso)}`;

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
          <h1 className="text-2xl font-semibold tracking-tight">{t('page.title')}</h1>
          <p className="text-sm capitalize text-muted-foreground">{dateLabel}</p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('queue.searchPlaceholder')}
            className="h-10 w-full rounded-full border border-input bg-muted/40 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* Sol: Ameliyat Adayları */}
        <aside className="flex min-h-0 flex-col rounded-xl border bg-background">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-sm font-semibold">{t('queue.candidates')}</span>
            {newCount > 0 && (
              <Badge variant="warning" dot>
                {t('queue.newCount', { count: newCount })}
              </Badge>
            )}
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {pipeline.isLoading && <div className="h-20 rounded-lg bg-muted" />}
            {!pipeline.isLoading && filtered.length === 0 && (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                {t('page.empty')}
              </p>
            )}
            {filtered.map((row) => (
              <SalesCard
                key={row.id}
                row={row}
                selected={selected?.id === row.id}
                onSelect={() => setSelectedId(row.id)}
                dateLocale={dateLocale}
                t={t}
              />
            ))}
          </div>
        </aside>

        {/* Sağ: Detay */}
        <section className="min-h-0 overflow-y-auto">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('detail.selectPrompt')}
            </div>
          ) : (
            <DetailPanel
              key={selected.id}
              row={selected}
              catalog={matchSurgeryServiceItem(selected.type, surgeryItems)}
              dateLocale={dateLocale}
              locale={locale}
              fmtWhen={fmtWhen}
              onChanged={() => void utils.surgery.salesPipeline.invalidate()}
              t={t}
            />
          )}
        </section>
      </div>
    </div>
  );
}

type TFn = ReturnType<typeof useTranslation>['t'];

function eyeLabel(eyeSide: string | null, t: TFn): string {
  if (eyeSide === 'od') return t('eye.od');
  if (eyeSide === 'os') return t('eye.os');
  if (eyeSide === 'ou') return t('eye.ou');
  return '—';
}

function SalesCard({
  row,
  selected,
  onSelect,
  dateLocale,
  t,
}: {
  row: PipelineRow;
  selected: boolean;
  onSelect: () => void;
  dateLocale: string;
  t: TFn;
}) {
  const age = ageFrom(row.patient.birthDate);
  const meta = STATUS_META[row.pipelineStatus];
  const summary = [surgeryName(row.type), lensLabel(row.type), eyeLabel(row.eyeSide, t)]
    .filter((x) => x && x !== '—')
    .join(' · ');

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/30'
          : 'border-transparent hover:bg-muted',
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {initials(row.patient.firstName, row.patient.lastName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">
            {row.patient.firstName} {row.patient.lastName}
            {age != null && <span className="text-muted-foreground"> · {age}</span>}
          </span>
          {row.invoiceTotal && (
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {formatCurrency(row.invoiceTotal, row.invoiceCurrency ?? 'TJS', dateLocale)}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{summary}</span>
        <Badge variant={meta.variant} dot className="mt-1">
          {t(meta.labelKey)}
        </Badge>
      </span>
    </button>
  );
}

function DetailPanel({
  row,
  catalog,
  dateLocale,
  locale,
  fmtWhen,
  onChanged,
  t,
}: {
  row: PipelineRow;
  catalog: ServiceItemRow | null;
  dateLocale: string;
  locale: string;
  fmtWhen: (iso: string) => string;
  onChanged: () => void;
  t: TFn;
}) {
  const age = ageFrom(row.patient.birthDate);
  const meta = STATUS_META[row.pipelineStatus];
  const note = row.preOp?.notes ?? null;

  return (
    <div className="space-y-4">
      {/* Hasta başlığı */}
      <div className="flex items-center gap-3 rounded-lg border bg-background p-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">
          {initials(row.patient.firstName, row.patient.lastName)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">
            {/* #370 — Karttan hasta detayına link (page:patients ALL_ROLES). */}
            <Link to={`/patients/${row.patient.id}`} className="hover:underline">
              {row.patient.firstName} {row.patient.lastName}
            </Link>
            {age != null && <span className="font-normal text-muted-foreground"> · {age}</span>}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
            {maskPhone(row.patient.phone) && <span>{maskPhone(row.patient.phone)}</span>}
            <span>{fmtWhen(row.scheduledAt)}</span>
            <Link
              to={`/patients/${row.patient.id}`}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" aria-hidden />
              {t('detail.patientDetail', { defaultValue: 'Hasta detayı' })}
            </Link>
          </div>
        </div>
        <Badge variant={meta.variant} dot className="shrink-0">
          {t(meta.labelKey)}
        </Badge>
      </div>

      {/* #370 — Salt-okunur klinik özet (tanı + ölçüm sayısı). */}
      {row.clinicalSummary &&
        (row.clinicalSummary.diagnosis || row.clinicalSummary.measurementCount > 0) && (
          <div className="rounded-lg border bg-background p-5">
            <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <FileText className="h-4 w-4" aria-hidden />
              {t('detail.clinicalSummary', { defaultValue: 'Klinik özet' })}
            </h3>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">
                  {t('detail.diagnosis', { defaultValue: 'Tanı' })}
                </dt>
                <dd className="text-sm">{row.clinicalSummary.diagnosis || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t('detail.measurementCount', { defaultValue: 'Ölçüm' })}
                </dt>
                <dd className="text-sm tabular-nums">{row.clinicalSummary.measurementCount}</dd>
              </div>
            </dl>
          </div>
        )}

      {/* DOKTOR ÖNERİSİ */}
      <div className="rounded-lg border bg-background p-5">
        <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Stethoscope className="h-4 w-4" aria-hidden />
          {t('detail.recommendation')}
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Field label={t('detail.surgery')} value={surgeryName(row.type)} />
          <Field label={t('detail.lens')} value={lensLabel(row.type)} />
          {/* v0.4.2 R6 — OD/OS eksik fiziksel uyarı (Ray 4): rose metin. */}
          <div className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('detail.eye')}
            </dt>
            {row.eyeSide ? (
              <dd className="truncate text-sm font-medium">{eyeLabel(row.eyeSide, t)}</dd>
            ) : (
              <dd className="flex items-center gap-1 truncate text-sm font-medium text-critical-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t('detail.eyeMissing', { defaultValue: 'Göz tarafı eksik' })}
              </dd>
            )}
          </div>
          <Field label={t('detail.recommender')} value={row.doctor?.name ?? '—'} />
        </dl>
        {note && (
          <blockquote className="mt-4 rounded-lg bg-muted/50 px-4 py-3 text-sm italic text-foreground">
            “{note}”
          </blockquote>
        )}
      </div>

      {/* v0.4.2 R6 — Onam durumu (Karar 6): satışı engellemez, ameliyat günü gerekir. */}
      <ConsentStatusCard patientId={row.patient.id} t={t} />

      {/* Fiyat & İndirim */}
      {row.pipelineStatus === 'new' ? (
        <PriceDiscountCard
          row={row}
          catalog={catalog}
          dateLocale={dateLocale}
          locale={locale}
          onChanged={onChanged}
          t={t}
        />
      ) : (
        <PriceSummaryCard row={row} dateLocale={dateLocale} t={t} />
      )}

      {/* Randevu Ver */}
      <RandevuCard row={row} disabled={row.pipelineStatus === 'new'} onChanged={onChanged} t={t} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

// v0.4.2 R6 (Karar 6) — Onam durumu: imzalı/imzasız metin. Satış/tahsilatı
// ENGELLEMEZ; ameliyat günü markCompleted imzasız bloklanır (mevcut kural).
function ConsentStatusCard({ patientId, t }: { patientId: string; t: TFn }) {
  const q = trpc.consent.listByPatient.useQuery(
    { patientId, includeRevoked: false },
    { staleTime: 60_000 },
  );
  if (q.isLoading) return null;
  const signed = (q.data?.length ?? 0) > 0;
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border p-4 text-sm',
        signed ? 'border-success-border bg-success-bg' : 'border-warning-border bg-warning-bg',
      )}
    >
      <FileSignature
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          signed ? 'text-success-foreground' : 'text-warning-foreground',
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <div
          className={cn(
            'font-medium',
            signed ? 'text-success-foreground' : 'text-warning-foreground',
          )}
        >
          {signed
            ? t('consent.signed', { defaultValue: 'Onam imzalı' })
            : t('consent.unsigned', { defaultValue: 'Onam imzasız' })}
        </div>
        {!signed && (
          <div className="mt-0.5 text-warning-foreground">
            {t('consent.unsignedHint', {
              defaultValue:
                'İmzasız ameliyat tamamlanamaz. Satış/tahsilat engellenmez; ameliyat günü onam imzası gerekir.',
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// #361 — Cap'ler artık backend'den (approval.myLimits): selfPercent = onay
// gerektiren eşik, absoluteMaxPercent = onayla bile aşılamayan tenant tavanı.
// Hardcode SELF_CAP kaldırıldı (çift kaynak hatası).
const QUICK_DISCOUNTS = [0, 5, 10, 20, 30];

function PriceDiscountCard({
  row,
  catalog,
  dateLocale,
  locale,
  onChanged,
  t,
}: {
  row: PipelineRow;
  catalog: ServiceItemRow | null;
  dateLocale: string;
  locale: string;
  onChanged: () => void;
  t: TFn;
}) {
  const [percent, setPercent] = useState(0);
  const [reason, setReason] = useState('');
  // v0.4.2 R6 (Karar 5) — opsiyonel upgrade kalemi (paket = tek fatura + ek kalem).
  const [upgrade, setUpgrade] = useState<{ desc: string; price: string } | null>(null);
  const limits = trpc.approval.myLimits.useQuery();
  const selfCap = limits.data?.selfPercent ?? 0;
  const absoluteCap = limits.data?.absoluteMaxPercent ?? 30;
  const catalogPrice = catalog ? Number(catalog.defaultPrice) : 0;
  const currency = catalog?.defaultCurrency ?? SURGERY_CATALOG_CURRENCY;
  const upgradePrice = upgrade ? Math.max(0, parseFloat(upgrade.price) || 0) : 0;
  const discountAmount = Math.round((catalogPrice * percent) / 100);
  const finalPrice = catalogPrice + upgradePrice - discountAmount;
  const needsApproval = percent > selfCap;
  const reasonOk = !needsApproval || reason.trim().length >= 10;
  const fmt = (n: number) => formatCurrency(n, currency, dateLocale);

  // #371 — Satış faturası kesildikten sonra tahsilat zinciri (makbuz dahil).
  // Eskiden yalnız toast + refetch vardı; satış temsilcisi tahsilatı ayrı ekranda
  // arıyordu. createInvoice → PaymentDialog (onPaid → makbuz).
  const [payChain, setPayChain] = useState<{
    invoiceId: string;
    currency: Currency;
    openBalance: number;
  } | null>(null);
  const create = trpc.billing.createInvoice.useMutation({
    onSuccess: (inv) => {
      toast.success(t('give.success'));
      onChanged();
      if (inv && inv.status !== 'paid') {
        setPayChain({
          invoiceId: inv.id,
          currency: inv.currency,
          openBalance: parseFloat(inv.total),
        });
      }
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  const apply = () => {
    if (catalogPrice <= 0 || !reasonOk) return;
    create.mutate({
      patientId: row.patient.id,
      surgeryId: row.id,
      items: [
        {
          serviceItemId: catalog?.id ?? null,
          description: catalog ? localizedServiceName(catalog, locale) : row.type,
          quantity: 1,
          unitPrice: String(catalogPrice),
        },
        ...(upgrade && upgradePrice > 0
          ? [
              {
                serviceItemId: null,
                description:
                  upgrade.desc.trim() ||
                  t('give.upgradeDefault', { defaultValue: 'Ek kalem (upgrade)' }),
                quantity: 1,
                unitPrice: String(upgradePrice),
              },
            ]
          : []),
      ],
      currency: currency as 'TJS' | 'USD',
      discount: discountAmount > 0 ? String(discountAmount) : '0',
      discountReason: needsApproval ? reason.trim() : undefined,
    });
  };

  return (
    <div className="rounded-lg border bg-background">
      <h3 className="flex items-center gap-1.5 border-b px-5 py-4 text-sm font-semibold">
        <Percent className="h-4 w-4 text-primary" aria-hidden />
        {t('give.title')}
      </h3>
      <div className="space-y-5 p-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('give.catalogPrice')}</span>
            <span className="font-medium tabular-nums">{fmt(catalogPrice)}</span>
          </div>
          {upgradePrice > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {t('give.upgradeLine', { defaultValue: 'Ek kalem (upgrade)' })}
              </span>
              <span className="font-medium tabular-nums">+{fmt(upgradePrice)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('give.discountLine', { percent })}</span>
            <span className="font-medium tabular-nums text-critical-foreground">
              −{fmt(discountAmount)}
            </span>
          </div>
          <div className="border-t pt-2">
            <div className="flex items-center justify-between">
              <span className="text-base font-semibold">{t('give.patientPays')}</span>
              <span className="text-2xl font-bold tabular-nums text-primary">
                {fmt(finalPrice)}
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('give.discountRate')}</span>
            <span className="font-semibold text-success-foreground">%{percent}</span>
          </div>
          <input
            type="range"
            min={0}
            max={absoluteCap}
            step={1}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
            aria-label={t('give.discountRate')}
            className="slider-touch w-full rounded accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {QUICK_DISCOUNTS.filter((q) => q <= absoluteCap).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setPercent(q)}
              aria-pressed={percent === q}
              className={cn(
                'rounded-lg border px-4 py-2 text-sm font-medium tabular-nums transition-colors',
                percent === q
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input hover:bg-muted',
              )}
            >
              % {q}
            </button>
          ))}
        </div>

        {/* v0.4.2 R6 (Karar 5) — opsiyonel upgrade kalemi */}
        {upgrade === null ? (
          <button
            type="button"
            onClick={() => setUpgrade({ desc: '', price: '' })}
            className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t('give.addUpgrade', { defaultValue: 'Ek kalem (upgrade) ekle' })}
          </button>
        ) : (
          <div className="space-y-2 rounded-lg border border-dashed border-input p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('give.upgradeTitle', { defaultValue: 'Ek kalem (upgrade)' })}
              </span>
              <button
                type="button"
                onClick={() => setUpgrade(null)}
                aria-label={t('actions.remove', { defaultValue: 'Kaldır' })}
              >
                <X className="h-4 w-4 text-muted-foreground" aria-hidden />
              </button>
            </div>
            <input
              type="text"
              value={upgrade.desc}
              onChange={(e) => setUpgrade((u) => (u ? { ...u, desc: e.target.value } : u))}
              placeholder={t('give.upgradeDesc', {
                defaultValue: 'Açıklama (örn. Premium trifokal lens)',
              })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              type="number"
              min={0}
              value={upgrade.price}
              onChange={(e) => setUpgrade((u) => (u ? { ...u, price: e.target.value } : u))}
              placeholder={t('give.upgradePrice', { defaultValue: 'Ek tutar (₸)' })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}

        <div
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-3 text-sm',
            needsApproval
              ? 'bg-warning-bg text-warning-foreground'
              : 'bg-success-bg text-success-foreground',
          )}
        >
          {needsApproval ? (
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          )}
          {needsApproval
            ? t('give.approvalNeeded', { cap: selfCap })
            : t('give.noApproval', { cap: selfCap })}
        </div>

        {needsApproval && (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={t('give.reasonLabel')}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}

        <div className="flex justify-end">
          <Button
            size="lg"
            onClick={apply}
            disabled={create.isPending || catalogPrice <= 0 || !reasonOk}
          >
            {create.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-4 w-4" />
            )}
            {t('give.apply')}
          </Button>
        </div>
      </div>

      {payChain && (
        <PaymentDialog
          invoiceId={payChain.invoiceId}
          invoiceCurrency={payChain.currency}
          openBalance={payChain.openBalance}
          onClose={() => setPayChain(null)}
          onSuccess={() => setPayChain(null)}
          onPaid={() => {
            toast.success(t('give.paidToast', { defaultValue: 'Tahsilat alındı' }));
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function PriceSummaryCard({
  row,
  dateLocale,
  t,
}: {
  row: PipelineRow;
  dateLocale: string;
  t: TFn;
}) {
  const meta = STATUS_META[row.pipelineStatus];
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Percent className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <p className="text-base font-semibold tabular-nums">
          {row.invoiceTotal
            ? formatCurrency(row.invoiceTotal, row.invoiceCurrency ?? 'TJS', dateLocale)
            : '—'}
        </p>
        <p className="text-sm text-muted-foreground">{t(meta.labelKey)}</p>
      </div>
    </div>
  );
}

function RandevuCard({
  row,
  disabled,
  onChanged,
  t,
}: {
  row: PipelineRow;
  disabled: boolean;
  onChanged: () => void;
  t: TFn;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-5">
        <div className="min-w-0">
          <p className="font-semibold">{t('schedule.title')}</p>
          <p className="text-sm text-muted-foreground">{t('schedule.description')}</p>
        </div>
        <Button size="lg" onClick={() => setOpen(true)} disabled={disabled}>
          <CalendarDays className="mr-1.5 h-4 w-4" />
          {t('schedule.give')}
        </Button>
      </div>
      <ScheduleDialog
        open={open}
        onOpenChange={setOpen}
        row={row}
        onDone={() => {
          setOpen(false);
          onChanged();
        }}
        t={t}
      />
    </>
  );
}

function ScheduleDialog({
  open,
  onOpenChange,
  row,
  onDone,
  t,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: PipelineRow;
  onDone: () => void;
  t: TFn;
}) {
  const [datetime, setDatetime] = useState('');
  const [doctorId, setDoctorId] = useState<string>('');
  useEffect(() => {
    if (open) {
      setDatetime('');
      setDoctorId(row.doctor?.id ?? '');
    }
  }, [open, row.doctor?.id]);

  // #369 — Cerrahi tip için yetkin doktorlar (uzmanlık eşleşen). Yetkin olmayanlar
  // da listede ama "(uzmanlık dışı)" etiketli; backend açık uyumsuz seçimi reddeder.
  const eligible = trpc.surgery.eligibleDoctors.useQuery({ surgeryId: row.id }, { enabled: open });
  const doctors = (eligible.data ?? []) as unknown as {
    id: string;
    name: string;
    specialty: string | null;
    isEligible: boolean;
  }[];

  const schedule = trpc.surgery.scheduleForSale.useMutation({
    onSuccess: () => {
      toast.success(t('schedule.success'));
      onDone();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  const submit = () => {
    if (!datetime) return;
    schedule.mutate({
      id: row.id,
      scheduledAt: new Date(datetime).toISOString(),
      ...(doctorId ? { doctorId } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('schedule.title')}</DialogTitle>
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            {row.doctor?.name ?? '—'} · {surgeryName(row.type)} · {row.patient.firstName}{' '}
            {row.patient.lastName}
          </p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              {t('schedule.doctorLabel', { defaultValue: 'Cerrah' })}
            </span>
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {doctors.length === 0 && row.doctor && (
                <option value={row.doctor.id}>{row.doctor.name}</option>
              )}
              {[...doctors]
                .sort((a, b) => Number(b.isEligible) - Number(a.isEligible))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.specialty ? ` · ${d.specialty}` : ''}
                    {d.isEligible
                      ? ''
                      : ` · ${t('schedule.outOfSpecialty', { defaultValue: 'uzmanlık dışı' })}`}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('schedule.dateLabel')}</span>
            <DateTimeField value={datetime} onChange={setDatetime} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('give.cancel')}
            </Button>
            <Button onClick={submit} disabled={schedule.isPending || !datetime}>
              {schedule.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t('schedule.confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
