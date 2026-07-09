import { useState } from 'react';
import { localeToIntl } from '../lib/i18n-format';
import { formatMoney } from '../lib/billing.constants';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../providers/LocaleProvider';
import { usePermission } from '../hooks/usePermission';
import { trpc } from '../lib/trpc';
import { billingApi } from '../lib/billing.trpc';
import { DataErrorState } from '../components/common/DataErrorState';
import { RefundApprovalsPanel } from '../components/billing/RefundApprovalsPanel';
import { PoApprovalsPanel } from '../components/billing/PoApprovalsPanel';
import { ApprovalRejectDialog } from '../components/billing/ApprovalRejectDialog';
import { DiscountReviewActions } from '../components/billing/DiscountReviewActions';
import { initials, formatPercent } from '../lib/approval-format';

// R4 (#726) — Yönetici onay merkezi. İndirim + İade + Satın Alma tek modül,
// sekmeli (Fraud ayrı sayfada). Her sekme kendi yetkisine göre görünür; içerik
// panel'leri yetkisiz aksiyonu gizler (incele görünür, finalize gate'li).
// İndirim verisi dashboard.pendingApprovals; iade/PO kendi panel'lerinde.

type TabKey = 'discount' | 'refund' | 'po';

export function ApprovalsPage() {
  const { t } = useTranslation(['common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';

  const canReviewDiscount = usePermission('action:approval.review');
  const canApproveRefund = usePermission('action:payment.refundApprove');
  const canApprovePo = usePermission('action:po.approve');

  // İndirim talepleri her zaman görünür (page:approvals ile gelinir; incele
  // herkese açık, Onayla/Reddet canReviewDiscount'a gate'li).
  const query = trpc.dashboard.pendingApprovals.useQuery(undefined, { refetchInterval: 30_000 });
  const utils = trpc.useUtils();
  const review = trpc.approval.review.useMutation({
    onSettled: () => {
      void utils.dashboard.pendingApprovals.invalidate();
      void utils.dashboard.adminOverview.invalidate();
    },
  });
  const data = query.data;
  const items = data?.items ?? [];
  // #726 — indirim red gerekçesi dialog'la alınır (native prompt yasak).
  const [rejectId, setRejectId] = useState<string | null>(null);

  // Sekme rozetleri — panel'lerle aynı query key (React Query dedup → tek istek).
  const refundCountQuery = billingApi.listPendingRefunds.useQuery(undefined, {
    enabled: canApproveRefund,
    refetchInterval: 30_000,
  });
  const poCountQuery = trpc.purchaseOrder.list.useQuery(
    { pendingApprovalOnly: true },
    { enabled: canApprovePo, refetchInterval: 30_000 },
  );

  const tabs: { key: TabKey; label: string; count: number; visible: boolean }[] = [
    {
      key: 'discount',
      label: t('common:adminOverview.approvalsPage.tabs.discount'),
      count: items.length,
      visible: true,
    },
    {
      key: 'refund',
      label: t('common:adminOverview.approvalsPage.tabs.refund'),
      count: refundCountQuery.data?.length ?? 0,
      visible: canApproveRefund,
    },
    {
      key: 'po',
      label: t('common:adminOverview.approvalsPage.tabs.po'),
      count: poCountQuery.data?.length ?? 0,
      visible: canApprovePo,
    },
  ];
  const visibleTabs = tabs.filter((tab) => tab.visible);
  const [active, setActive] = useState<TabKey>('discount');
  const activeTab = visibleTabs.some((tab) => tab.key === active) ? active : 'discount';

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

  const fmtMoney = (value: string): string =>
    formatMoney(value, 'TJS', dateLocale, { fractionDigits: 0 });

  return (
    <div className="space-y-6" data-testid="approvals-root">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t('common:adminOverview.approvalsPage.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {datePart}, {weekdayCap}
          {data?.clinicName ? ` · ${data.clinicName}` : ''}
        </p>
      </div>

      {/* Sekmeler */}
      {visibleTabs.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              data-testid={`approvals-tab-${tab.key}`}
              onClick={() => setActive(tab.key)}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning-bg px-1.5 text-xs font-semibold tabular-nums text-warning-foreground">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* İade sekmesi */}
      {activeTab === 'refund' && <RefundApprovalsPanel />}

      {/* Satın Alma sekmesi */}
      {activeTab === 'po' && <PoApprovalsPanel />}

      {/* İndirim sekmesi */}
      {activeTab === 'discount' && (
        <div className="space-y-4">
          {/* >%10 kural metni */}
          <div className="flex items-start gap-2 rounded-lg border border-info-border bg-info-bg px-4 py-3 text-sm text-info-foreground">
            <Info
              className="mt-0.5 h-4 w-4 shrink-0 text-info-foreground"
              strokeWidth={1.5}
              aria-hidden
            />
            <span>{t('common:adminOverview.approvalsPage.discountRule')}</span>
          </div>

          <div className="rounded-lg border bg-background">
            <header className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-base font-semibold">
                {t('common:adminOverview.approvalsPage.pendingTitle')}
              </h2>
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-warning-bg px-2 text-xs font-semibold tabular-nums text-warning-foreground">
                {items.length}
              </span>
            </header>

            <div className="space-y-4 p-4">
              {query.isError && !data ? (
                <DataErrorState onRetry={() => query.refetch()} />
              ) : !data ? (
                <div className="space-y-2">
                  <div className="h-4 w-1/3 rounded bg-muted" />
                  <div className="h-4 w-2/3 rounded bg-muted" />
                </div>
              ) : items.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  {t('common:adminOverview.approvalsPage.empty')}
                </div>
              ) : (
                items.map((a) => (
                  <div key={a.id} className="rounded-lg border bg-muted/20 p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {initials(a.patientName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-semibold">{a.patientName}</div>
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
                      </div>
                    </div>

                    {/* Gerekçe */}
                    {a.reason && (
                      <blockquote className="mt-3 rounded-lg border bg-background px-4 py-3 text-sm text-foreground">
                        “{a.reason}”
                      </blockquote>
                    )}

                    {/* Tutarlar + aksiyonlar */}
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                      <div className="flex gap-6 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">
                            {t('common:adminOverview.approvals.list')}
                          </div>
                          <div className="font-semibold tabular-nums">{fmtMoney(a.listAmount)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">
                            {t('common:adminOverview.approvals.discounted')}
                          </div>
                          <div className="font-semibold tabular-nums text-primary">
                            {fmtMoney(a.discountedAmount ?? a.listAmount)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">
                            {t('common:adminOverview.approvals.loss')}
                          </div>
                          <div className="font-semibold tabular-nums text-critical-foreground">
                            {fmtMoney(`-${a.lossAmount}`)}
                          </div>
                        </div>
                      </div>
                      {canReviewDiscount && (
                        <DiscountReviewActions
                          disabled={review.isPending}
                          onReject={() => setRejectId(a.id)}
                          onApprove={() => review.mutate({ id: a.id, decision: 'approved' })}
                        />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
}
