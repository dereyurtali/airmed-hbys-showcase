import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { localeToIntl, getDateTimeFormat } from '../lib/i18n-format';
import { useState } from 'react';
import { AlertTriangle, FileClock, Lock, RefreshCw, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { RefundApprovalsPanel } from '../components/billing/RefundApprovalsPanel';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { confirmIfDirty } from '../hooks/useUnsavedWarning';
import { formatMoney } from '../lib/billing.constants';
import type { PaymentMethod } from '../lib/billing.constants';
import { PaymentMethodIcon } from '../components/billing/PaymentMethodIcon';
import { billingApi } from '../lib/billing.trpc';
import { usePermission } from '../hooks/usePermission';
import { useLocale } from '../providers/LocaleProvider';

// billing.trpc LooseMutation'lar runtime'da trpc.billing.*; UI tarafında
// minimal mutation şekli yeterli (cast).
type MutationLike<TInput> = {
  useMutation: (opts?: {
    onSuccess?: (data: unknown) => void;
    onError?: (err: { message: string }) => void;
  }) => { mutate: (input: TInput) => void; isPending: boolean };
};

export function CashRegisterPage() {
  const { t } = useTranslation(['billing', 'common']);
  const { locale } = useLocale();
  const dateFmt = getDateTimeFormat(localeToIntl(locale) ?? 'tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const canClose = usePermission('action:cashRegister.close');
  const canPrepareDraft = usePermission('action:cashRegister.prepareDraft');

  // dialogMode: notlu dialog hem direkt kapatma hem taslak hazırlama için.
  const [dialogMode, setDialogMode] = useState<'close' | 'prepare' | null>(null);
  const [notes, setNotes] = useState('');
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  const snapshotQuery = billingApi.cashSnapshot.useQuery({});
  const historyQuery = billingApi.listCashClosures.useQuery({ page: 1, pageSize: 10 });
  const draftQuery = billingApi.currentCashDraft.useQuery({});
  const draft = draftQuery.data ?? null;

  const refetchAll = () => {
    void snapshotQuery.refetch();
    void historyQuery.refetch();
    void draftQuery.refetch();
  };

  const closeMutation = (
    billingApi.closeCashRegister as unknown as MutationLike<{ notes?: string | null }>
  ).useMutation({
    onSuccess: () => {
      toast.success(t('billing:cashRegister.closedToast'));
      refetchAll();
      setDialogMode(null);
      setNotes('');
    },
    onError: (err) => toast.error(err.message ?? 'Hata'),
  });

  const prepareMutation = (
    billingApi.prepareCashDraft as unknown as MutationLike<{ notes?: string | null }>
  ).useMutation({
    onSuccess: () => {
      toast.success(t('billing:cashRegister.draftPreparedToast'));
      refetchAll();
      setDialogMode(null);
      setNotes('');
    },
    onError: (err) => toast.error(err.message ?? 'Hata'),
  });

  const finalizeMutation = (
    billingApi.finalizeCashDraft as unknown as MutationLike<{ id: string }>
  ).useMutation({
    onSuccess: () => {
      toast.success(t('billing:cashRegister.closedToast'));
      refetchAll();
      setFinalizeOpen(false);
    },
    onError: (err) => toast.error(err.message ?? 'Hata'),
  });

  const discardMutation = (
    billingApi.discardCashDraft as unknown as MutationLike<{ id: string }>
  ).useMutation({
    onSuccess: () => {
      toast.success(t('billing:cashRegister.draftDiscardedToast'));
      refetchAll();
    },
    onError: (err) => toast.error(err.message ?? 'Hata'),
  });

  const snap = snapshotQuery.data;
  const hasUnclosed = (snap?.paymentCount ?? 0) > 0 || (snap?.refundCount ?? 0) > 0;
  const submitting = closeMutation.isPending || prepareMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('billing:cashRegister.title')}
        description={t('billing:cashRegister.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void snapshotQuery.refetch();
                void historyQuery.refetch();
              }}
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              {t('common:actions.refresh', { defaultValue: 'Yenile' })}
            </Button>
            {/* R5 (#727) — taslak varsa: yönetici finalize/iptal; yoksa direkt
                kapat (yetkili) ya da taslak hazırla (asistan). */}
            {draft ? (
              <>
                {canClose && (
                  <Button size="sm" onClick={() => setFinalizeOpen(true)}>
                    <Lock className="mr-1 h-4 w-4" />
                    {t('billing:cashRegister.finalizeDraft')}
                  </Button>
                )}
                {canPrepareDraft && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={discardMutation.isPending}
                    onClick={() => discardMutation.mutate({ id: draft.id })}
                  >
                    {t('billing:cashRegister.discardDraft')}
                  </Button>
                )}
              </>
            ) : (
              hasUnclosed &&
              (canClose ? (
                <Button size="sm" onClick={() => setDialogMode('close')}>
                  <Lock className="mr-1 h-4 w-4" />
                  {t('billing:cashRegister.close')}
                </Button>
              ) : (
                canPrepareDraft && (
                  <Button size="sm" variant="outline" onClick={() => setDialogMode('prepare')}>
                    <FileClock className="mr-1 h-4 w-4" />
                    {t('billing:cashRegister.prepareDraft')}
                  </Button>
                )
              ))
            )}
          </div>
        }
      />

      {/* S15-PR15b — Onay bekleyen iadeler (yalnız yöneticilerde render olur) */}
      <RefundApprovalsPanel />

      {/* R5 (#727) — Bekleyen kapatma taslağı (asistan hazırladı, yönetici finalize eder) */}
      {draft && (
        <section className="rounded-lg border border-warning-border bg-warning-bg p-4">
          <div className="flex items-start gap-3">
            <FileClock className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-warning-foreground">
                {t('billing:cashRegister.draftPendingTitle')}
              </h2>
              <p className="mt-0.5 text-sm text-warning-foreground">
                {t('billing:cashRegister.draftPendingHint', {
                  name: draft.preparedBy?.name ?? '—',
                })}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <SnapshotCard
                  title={t('billing:cashRegister.totalTjsEquivalent')}
                  value={formatMoney(draft.totalTjsEquivalent, 'TJS', localeToIntl(locale))}
                  highlight
                />
                <SnapshotCard
                  title={t('billing:cashRegister.netTjsEquivalent')}
                  value={formatMoney(draft.netTjsEquivalent, 'TJS', localeToIntl(locale))}
                  highlight
                />
                <SnapshotCard
                  title={t('billing:cashRegister.paymentCount')}
                  value={String(draft.paymentCount)}
                />
              </div>
              {draft.notes && (
                <p className="mt-3 rounded-lg border bg-background px-3 py-2 text-sm">
                  “{draft.notes}”
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Snapshot */}
      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-base font-semibold">{t('billing:cashRegister.snapshot')}</h2>
        {snapshotQuery.isLoading && (
          <p className="text-sm text-muted-foreground">{t('common:states.loading')}</p>
        )}
        {snap && !hasUnclosed && (
          <p className="text-sm text-muted-foreground">
            {t('billing:cashRegister.noUnclosedRecords')}
          </p>
        )}
        {snap && hasUnclosed && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <SnapshotCard
                title={t('billing:cashRegister.totalTjs')}
                value={formatMoney(snap.totalTjs, 'TJS', localeToIntl(locale))}
              />
              <SnapshotCard
                title={t('billing:cashRegister.totalUsd')}
                value={formatMoney(snap.totalUsd, 'USD', localeToIntl(locale))}
              />
              <SnapshotCard
                title={t('billing:cashRegister.totalTjsEquivalent')}
                value={formatMoney(snap.totalTjsEquivalent, 'TJS', localeToIntl(locale))}
                highlight
              />
              <SnapshotCard
                title={t('billing:cashRegister.netTjsEquivalent')}
                value={formatMoney(snap.netTjsEquivalent, 'TJS', localeToIntl(locale))}
                highlight
              />
            </div>

            {/* By method */}
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                {t('billing:cashRegister.byMethod')}
              </h3>
              <div className="grid gap-2 sm:grid-cols-4">
                {(['cash', 'card', 'transfer', 'insurance'] as PaymentMethod[]).map((m) => {
                  const tjs = snap[`${m}Tjs` as keyof typeof snap] as string;
                  const usd = snap[`${m}Usd` as keyof typeof snap] as string;
                  return (
                    <div key={m} className="rounded border p-2 text-sm">
                      <div className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <PaymentMethodIcon method={m} /> {t(`billing:payment.methods.${m}`)}
                      </div>
                      <div className="tabular-nums">
                        {formatMoney(tjs, 'TJS', localeToIntl(locale))}
                      </div>
                      {parseFloat(usd) > 0 && (
                        <div className="text-xs tabular-nums text-muted-foreground">
                          {formatMoney(usd, 'USD', localeToIntl(locale))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent payments */}
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                {snap.paymentCount} {t('billing:cashRegister.paymentCount')}
              </h3>
              <ul className="max-h-72 space-y-1 overflow-auto rounded-lg border p-2 text-xs">
                {snap.payments.map((p) => (
                  <li key={p.id} className="flex justify-between">
                    <span>
                      <PaymentMethodIcon method={p.method as PaymentMethod} />{' '}
                      {p.invoice.invoiceNumber} · {p.takenBy.name}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatMoney(p.amount, p.currency, localeToIntl(locale))}
                    </span>
                  </li>
                ))}
              </ul>
              {snap.refundCount > 0 && (
                <>
                  <h3 className="mb-2 mt-3 text-sm font-medium text-muted-foreground">
                    {snap.refundCount} {t('billing:cashRegister.refundCount')}
                  </h3>
                  <ul className="max-h-48 space-y-1 overflow-auto rounded-lg border p-2 text-xs">
                    {snap.refunds.map((r) => (
                      <li key={r.id} className="flex justify-between text-critical-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Undo2 className="h-3 w-3 shrink-0" aria-hidden />
                          {r.payment.invoice.invoiceNumber} · {r.approvedBy?.name ?? '—'}
                        </span>
                        <span className="font-medium tabular-nums">
                          {formatMoney(r.amount, r.currency, localeToIntl(locale))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {/* History */}
      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-base font-semibold">{t('billing:cashRegister.history')}</h2>
        {historyQuery.isLoading && (
          <p className="text-sm text-muted-foreground">{t('common:states.loading')}</p>
        )}
        {historyQuery.data && historyQuery.data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('billing:cashRegister.noClosures')}</p>
        )}
        {historyQuery.data && historyQuery.data.items.length > 0 && (
          <Table className="w-full text-sm">
            <TableHeader className="border-b text-xs uppercase text-muted-foreground">
              <TableRow>
                <TableHead className="py-2 text-left">
                  {t('billing:cashRegister.closedAt')}
                </TableHead>
                <TableHead className="py-2 text-left">
                  {t('billing:cashRegister.closedBy')}
                </TableHead>
                <TableHead className="py-2 text-right">
                  {t('billing:cashRegister.paymentCount')}
                </TableHead>
                <TableHead className="py-2 text-right">
                  {t('billing:cashRegister.totalTjsEquivalent')}
                </TableHead>
                <TableHead className="py-2 text-right">
                  {t('billing:cashRegister.netTjsEquivalent')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyQuery.data.items.map((c) => (
                <TableRow key={c.id} className="border-b last:border-0">
                  <TableCell className="py-2">{dateFmt.format(new Date(c.closedAt))}</TableCell>
                  <TableCell className="py-2">{c.closedBy.name}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums">{c.paymentCount}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums">
                    {formatMoney(c.totalTjsEquivalent, 'TJS', localeToIntl(locale))}
                  </TableCell>
                  <TableCell className="py-2 text-right font-medium tabular-nums">
                    {formatMoney(c.netTjsEquivalent, 'TJS', localeToIntl(locale))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog
        open={dialogMode !== null}
        onOpenChange={(next) => {
          if (next) return;
          if (!confirmIfDirty(notes !== '', t('common:forms.unsavedConfirm'))) return;
          setDialogMode(null);
        }}
      >
        <DialogContent>
          <DialogTitle className="mb-3">
            {dialogMode === 'prepare'
              ? t('billing:cashRegister.prepareDraft')
              : t('billing:cashRegister.close')}
          </DialogTitle>
          <p className="mb-3 inline-flex items-center gap-1.5 text-sm text-warning-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {dialogMode === 'prepare'
              ? t('billing:cashRegister.prepareConfirm')
              : t('billing:cashRegister.closeConfirm')}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (dialogMode === 'prepare') {
                prepareMutation.mutate({ notes: notes || null });
              } else {
                closeMutation.mutate({ notes: notes || null });
              }
            }}
          >
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('billing:cashRegister.closeNotesPlaceholder')}
              rows={3}
              maxLength={1000}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogMode(null)}>
                {t('common:actions.cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {dialogMode === 'prepare'
                  ? t('billing:cashRegister.prepareDraft')
                  : t('billing:cashRegister.close')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* R5 (#727) — Taslak finalize teyidi (geri-dönüşsüz kapanış) */}
      <ConfirmDialog
        open={finalizeOpen}
        onOpenChange={setFinalizeOpen}
        title={t('billing:cashRegister.finalizeDraft')}
        description={t('billing:cashRegister.finalizeConfirm')}
        confirmLabel={t('billing:cashRegister.finalizeDraft')}
        variant="default"
        pending={finalizeMutation.isPending}
        onConfirm={() => draft && finalizeMutation.mutate({ id: draft.id })}
      />
    </div>
  );
}

function SnapshotCard({
  title,
  value,
  highlight = false,
}: {
  title: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'bg-primary/5 border-primary/30' : ''}`}>
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}
