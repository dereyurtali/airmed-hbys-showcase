import { useState } from 'react';
import { localeToIntl } from '../lib/i18n-format';
import { formatMoney } from '../lib/billing.constants';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ClipboardList,
  Eye,
  Layers,
  Package,
  ShieldCheck,
  Stethoscope,
  Tag,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useLocale } from '../providers/LocaleProvider';
import { trpc } from '../lib/trpc';
import { mapTrpcError } from '../lib/trpc-error';
import { DataErrorState } from '../components/common/DataErrorState';
import { RefundApprovalsPanel } from '../components/billing/RefundApprovalsPanel';
import { PoApprovalsPanel } from '../components/billing/PoApprovalsPanel';
import { ApprovalRejectDialog } from '../components/billing/ApprovalRejectDialog';
import { DiscountReviewActions } from '../components/billing/DiscountReviewActions';
import { initials, formatPercent } from '../lib/approval-format';

// S16 — Yönetici "Genel Bakış" (bespoke overview). DashboardPage'den yalnız
// sadece-yönetici kullanıcılar için erken-return ile render edilir. Tüm veri
// tek aggregate sorgudan (dashboard.adminOverview); Onay/Reddet → approval.review.

const KNOWN_LENS_TYPES = ['monofocal', 'trifocal', 'edof', 'toric'];

function lensLabel(t: (k: string) => string, lensType: string | null): string {
  if (lensType && KNOWN_LENS_TYPES.includes(lensType)) {
    return t(`common:adminOverview.lensType.${lensType}`);
  }
  return t('common:adminOverview.lensType.other');
}

function formatTjs0(amount: string | number, locale: string): string {
  return formatMoney(amount, 'TJS', locale, { fractionDigits: 0 });
}

export function AdminOverviewPage() {
  const { t } = useTranslation(['common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';

  const overview = trpc.dashboard.adminOverview.useQuery(undefined, { refetchInterval: 30_000 });
  const utils = trpc.useUtils();
  // #726 — indirim red gerekçesi dialog'la alınır (native prompt yasak).
  const [rejectId, setRejectId] = useState<string | null>(null);
  // #402 — Onayla/Reddet feedback'i: eskiden onSuccess/onError yoktu → ağ
  // hatasında kullanıcı "onayladım" sanıyordu. Şimdi karara göre toast.
  const review = trpc.approval.review.useMutation({
    onSuccess: (_data, vars) => {
      toast.success(
        vars.decision === 'approved'
          ? t('common:adminOverview.approvals.approvedToast', { defaultValue: 'İndirim onaylandı' })
          : t('common:adminOverview.approvals.rejectedToast', {
              defaultValue: 'İndirim reddedildi',
            }),
      );
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
    onSettled: () => {
      void utils.dashboard.adminOverview.invalidate();
    },
  });
  const data = overview.data;

  const now = new Date();
  const datePart = now.toLocaleDateString(dateLocale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const weekday = now.toLocaleDateString(dateLocale, { weekday: 'long' });
  const weekdayCap = weekday.charAt(0).toLocaleUpperCase(dateLocale) + weekday.slice(1);

  const fmtRelative = (iso: string): string => {
    const d = new Date(iso);
    const time = d.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' });
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const startYesterday = new Date(startToday);
    startYesterday.setDate(startYesterday.getDate() - 1);
    if (d >= startToday) return `${t('common:adminOverview.relative.today')} ${time}`;
    if (d >= startYesterday) return `${t('common:adminOverview.relative.yesterday')} ${time}`;
    return `${d.toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })} ${time}`;
  };

  const delta = data?.todayCollected.deltaPercent ?? null;

  return (
    <div className="space-y-6" data-testid="admin-overview-root">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('common:adminOverview.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {datePart}, {weekdayCap}
          {data?.clinicName ? ` · ${data.clinicName}` : ''}
        </p>
      </div>

      {overview.isError && !data ? (
        <DataErrorState onRetry={() => overview.refetch()} />
      ) : (
        <>
          {/* KPI row */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Stethoscope}
              tint="sky"
              value={data?.todayExaminations ?? '—'}
              label={t('common:adminOverview.kpi.todayExams')}
              badge={
                <span className="rounded-full bg-info-bg px-2 py-0.5 text-xs font-medium text-info-foreground">
                  {t('common:adminOverview.kpi.live')}
                </span>
              }
            />
            <StatCard
              icon={ClipboardList}
              tint="emerald"
              value={data ? formatTjs0(data.todayCollected.amount, dateLocale) : '—'}
              label={t('common:adminOverview.kpi.todayCollected')}
              badge={
                delta !== null ? (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                      delta >= 0
                        ? 'bg-success-bg text-success-foreground'
                        : 'bg-critical-bg text-critical-foreground'
                    }`}
                  >
                    {delta >= 0 ? (
                      <TrendingUp className="h-3 w-3" strokeWidth={1.5} aria-hidden />
                    ) : (
                      <TrendingDown className="h-3 w-3" strokeWidth={1.5} aria-hidden />
                    )}
                    {delta >= 0 ? '+' : ''}
                    {delta}%
                  </span>
                ) : null
              }
            />
            <StatCard
              icon={Tag}
              tint="blue"
              value={data?.activeSurgerySales ?? '—'}
              label={t('common:adminOverview.kpi.activeSales')}
            />
            <StatCard
              icon={ShieldCheck}
              tint="amber"
              value={data?.pendingApprovalCount ?? '—'}
              label={t('common:adminOverview.kpi.pendingDiscount')}
            />
          </section>

          {/* Mid: approvals (left) + critical stock (right) */}
          <section className="grid gap-4 lg:grid-cols-12">
            {/* Bekleyen İndirim Onayları */}
            <div className="rounded-lg border bg-background lg:col-span-7">
              <header className="flex items-center justify-between border-b px-5 py-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck
                    className="h-[18px] w-[18px] text-warning-foreground"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                  <h2 className="text-base font-semibold">
                    {t('common:adminOverview.approvals.title')}
                  </h2>
                </div>
                <Link
                  to="/approvals"
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  {t('common:adminOverview.approvals.all')}
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                </Link>
              </header>
              <div className="divide-y">
                {!data ? (
                  <PanelSkeleton />
                ) : data.pendingApprovals.length === 0 ? (
                  <EmptyRow text={t('common:adminOverview.approvals.empty')} />
                ) : (
                  data.pendingApprovals.map((a) => (
                    <div key={a.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {initials(a.patientName)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-semibold">{a.patientName}</span>
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-foreground">
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-warning-foreground"
                                aria-hidden
                              />
                              {t('common:adminOverview.approvals.discountBadge', {
                                percent: formatPercent(a.discountPercent),
                              })}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-sm text-muted-foreground">
                            {[
                              a.surgeryType,
                              t('common:adminOverview.approvals.requestedBy', {
                                name: a.requestedByName ?? '—',
                              }),
                              fmtRelative(a.createdAt),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 pl-12">
                        <div className="flex gap-5 text-sm">
                          <Amount
                            label={t('common:adminOverview.approvals.list')}
                            value={a.listAmount}
                            locale={dateLocale}
                          />
                          <Amount
                            label={t('common:adminOverview.approvals.discounted')}
                            value={a.discountedAmount ?? a.listAmount}
                            locale={dateLocale}
                            tone="primary"
                          />
                          <Amount
                            label={t('common:adminOverview.approvals.loss')}
                            value={`-${a.lossAmount}`}
                            locale={dateLocale}
                            tone="loss"
                          />
                        </div>
                        <DiscountReviewActions
                          disabled={review.isPending}
                          onReject={() => setRejectId(a.id)}
                          onApprove={() => review.mutate({ id: a.id, decision: 'approved' })}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Kritik Stok */}
            <div className="rounded-lg border bg-background lg:col-span-5">
              <header className="flex items-center justify-between border-b px-5 py-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle
                    className="h-[18px] w-[18px] text-critical-foreground"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                  <h2 className="text-base font-semibold">
                    {t('common:adminOverview.stock.title')}
                  </h2>
                </div>
                <Link
                  to="/inventory/iol"
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  {t('common:adminOverview.stock.all')}
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                </Link>
              </header>
              <div className="divide-y">
                {!data ? (
                  <PanelSkeleton />
                ) : data.lowStock.length === 0 ? (
                  <EmptyRow text={t('common:adminOverview.stock.empty')} />
                ) : (
                  data.lowStock.map((s) => {
                    const Icon = s.kind === 'iol' ? Eye : Package;
                    const name = s.kind === 'iol' ? lensLabel(t, s.lensType) : (s.name ?? '—');
                    return (
                      <div key={`${s.kind}-${s.id}`} className="flex items-center gap-3 p-4">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-critical-bg text-critical-foreground">
                          <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{name}</div>
                          <div className="text-xs text-muted-foreground">
                            {t('common:adminOverview.stock.availMin', {
                              avail: s.availableQty,
                              min: s.minQty,
                            })}
                          </div>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-critical-bg px-2 py-0.5 text-xs font-medium text-critical-foreground">
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-critical-foreground"
                            aria-hidden
                          />
                          {t('common:adminOverview.stock.low')}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          {/* İade + Satın Alma onayları (inline; her panel kendi yetkisine göre
              görünür — yetkisiz kullanıcıda null). #726 R4. */}
          <section className="grid gap-4 lg:grid-cols-2">
            <RefundApprovalsPanel />
            <PoApprovalsPanel />
          </section>

          {/* Lens İhtiyacı */}
          <section className="rounded-lg border bg-background">
            <header className="flex items-center justify-between border-b px-5 py-3">
              <div className="flex items-center gap-2">
                <Layers className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} aria-hidden />
                <h2 className="text-base font-semibold">{t('common:adminOverview.lens.title')}</h2>
              </div>
              <span className="text-xs text-muted-foreground">
                {t('common:adminOverview.lens.auto')}
              </span>
            </header>
            <div className="p-4">
              {!data ? (
                <PanelSkeleton />
              ) : data.lensNeeds.length === 0 ? (
                <EmptyRow text={t('common:adminOverview.lens.empty')} />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.lensNeeds.map((n) => {
                    // #413 — Mevcut < ihtiyaç ise yetersiz: kart + sayı critical
                    // (eskiden her zaman yeşildi → yetersiz stok yeşil görünüyordu).
                    const insufficient = n.availableQty < n.neededCount;
                    return (
                      <div
                        key={n.lensType}
                        className={
                          'rounded-lg border p-4 ' +
                          (insufficient ? 'border-critical-border bg-critical-bg' : 'bg-muted/30')
                        }
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{lensLabel(t, n.lensType)}</span>
                          <Eye
                            className="h-4 w-4 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden
                          />
                        </div>
                        <div className="mt-2 flex items-baseline gap-2">
                          <span className="text-2xl font-bold tabular-nums">{n.neededCount}</span>
                          <span className="text-sm text-muted-foreground">
                            {t('common:adminOverview.lens.needed')}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t('common:adminOverview.lens.available')}{' '}
                          <span
                            className={
                              'inline-flex items-center gap-0.5 font-semibold tabular-nums ' +
                              (insufficient
                                ? 'text-critical-foreground'
                                : 'text-success-foreground')
                            }
                          >
                            {insufficient ? (
                              <AlertTriangle className="h-3 w-3" aria-hidden />
                            ) : (
                              <Check className="h-3 w-3" aria-hidden />
                            )}
                            {n.availableQty}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <ApprovalRejectDialog
            open={rejectId !== null}
            onOpenChange={(o) => !o && setRejectId(null)}
            pending={review.isPending}
            onConfirm={(reason) => {
              if (!rejectId) return;
              review.mutate(
                { id: rejectId, decision: 'rejected', note: reason },
                { onSuccess: () => setRejectId(null) },
              );
            }}
          />
        </>
      )}
    </div>
  );
}

const TINT_CLASSES: Record<string, string> = {
  sky: 'bg-info-bg text-info-foreground',
  emerald: 'bg-success-bg text-success-foreground',
  blue: 'bg-info-bg text-info-foreground',
  amber: 'bg-warning-bg text-warning-foreground',
};

function StatCard({
  icon: Icon,
  tint,
  value,
  label,
  badge,
}: {
  icon: typeof Stethoscope;
  tint: keyof typeof TINT_CLASSES;
  value: number | string;
  label: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-background p-5">
      <div className="flex items-start justify-between">
        <span
          className={`flex h-11 w-11 items-center justify-center rounded-lg ${TINT_CLASSES[tint]}`}
        >
          <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
        </span>
        {badge}
      </div>
      <div className="mt-4 text-3xl font-bold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function Amount({
  label,
  value,
  locale,
  tone,
}: {
  label: string;
  value: string;
  locale: string;
  tone?: 'primary' | 'loss';
}) {
  const display = formatMoney(value, 'TJS', locale, { fractionDigits: 0 });
  const toneClass =
    tone === 'primary'
      ? 'text-primary'
      : tone === 'loss'
        ? 'text-critical-foreground'
        : 'text-foreground';
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-semibold tabular-nums ${toneClass}`}>{display}</div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="px-5 py-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function PanelSkeleton() {
  return (
    <div className="space-y-2 p-4">
      <div className="h-4 w-1/3 rounded bg-muted" />
      <div className="h-4 w-2/3 rounded bg-muted" />
    </div>
  );
}
