import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { billingApi, type PendingRefundRow } from '../../lib/billing.trpc';
import { mapTrpcError } from '../../lib/trpc-error';
import { usePermission } from '../../hooks/usePermission';

// S15-PR15b — Yönetici onay paneli. Pending iade taleplerini listeler;
// onayla/reddet/ret-sebebi gir. Sadece action:payment.refundApprove yetkisi
// olan kullanıcılarda render olur.

export function RefundApprovalsPanel() {
  const { t } = useTranslation(['billing', 'common']);
  const canApprove = usePermission('action:payment.refundApprove');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const pendingQuery = billingApi.listPendingRefunds.useQuery(undefined, {
    enabled: canApprove,
    refetchInterval: 30_000,
  });

  const approveMutation = billingApi.approveRefund.useMutation({
    onSuccess: () => {
      toast.success(t('billing:refund.approved'));
      void pendingQuery.refetch();
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });

  const rejectMutation = billingApi.rejectRefund.useMutation({
    onSuccess: () => {
      toast.success(t('billing:refund.rejected'));
      setRejectingId(null);
      setRejectReason('');
      void pendingQuery.refetch();
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });

  if (!canApprove) return null;

  const rows = pendingQuery.data ?? [];

  return (
    <section className="rounded-lg border bg-card p-4" data-testid="refund-approvals-panel">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">{t('billing:refund.pendingTitle')}</h2>
        <span className="text-xs text-muted-foreground">
          {t('billing:refund.pendingCount', { count: rows.length })}
        </span>
      </header>

      {pendingQuery.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common:loading')}
        </div>
      )}

      {!pendingQuery.isLoading && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('billing:refund.pendingEmpty')}</p>
      )}

      <ul className="space-y-2">
        {rows.map((r: PendingRefundRow) => (
          <li
            key={r.id}
            className="rounded-lg border bg-background p-3"
            data-testid={`pending-refund-${r.id}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium tabular-nums">
                  {r.amount} {r.currency} · {r.payment.invoice.invoiceNumber}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('billing:refund.requestedBy')}: {r.requestedBy.name}
                </div>
                <p className="mt-1 text-sm">{r.reason}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="default"
                  data-testid={`approve-${r.id}`}
                  disabled={approveMutation.isPending}
                  onClick={() => approveMutation.mutate({ refundId: r.id })}
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                  {t('billing:refund.approve')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`reject-${r.id}`}
                  onClick={() => {
                    setRejectingId(r.id);
                    setRejectReason('');
                  }}
                >
                  <XCircle className="mr-1 h-4 w-4" />
                  {t('billing:refund.reject')}
                </Button>
              </div>
            </div>

            {rejectingId === r.id && (
              <div className="mt-3 space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">
                    {t('billing:refund.rejectReasonLabel')}
                  </span>
                  <textarea
                    className="min-h-[60px] w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    minLength={10}
                    maxLength={500}
                    data-testid={`reject-reason-${r.id}`}
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {rejectReason.length}/500 — {t('billing:refund.rejectReasonHint')}
                  </span>
                </label>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setRejectingId(null)}>
                    {t('common:actions.cancel')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={rejectReason.trim().length < 10 || rejectMutation.isPending}
                    onClick={() =>
                      rejectMutation.mutate({
                        refundId: r.id,
                        rejectionReason: rejectReason.trim(),
                      })
                    }
                    data-testid={`confirm-reject-${r.id}`}
                  >
                    {t('billing:refund.confirmReject')}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
