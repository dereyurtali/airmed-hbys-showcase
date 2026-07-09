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
import { useNavigate, useParams } from 'react-router-dom';
import { Ban, Download, Info, Plus, RotateCcw, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { PaymentDialog } from '../components/billing/PaymentDialog';
import { RefundDialog } from '../components/billing/RefundDialog';
import { CancelInvoiceDialog } from '../components/billing/CancelInvoiceDialog';
import {
  INVOICE_STATUS_COLORS,
  formatMoney,
  type InvoiceStatus,
  type PaymentMethod,
} from '../lib/billing.constants';
import { PaymentMethodIcon } from '../components/billing/PaymentMethodIcon';
import { billingApi, type PaymentRow, type RefundRow } from '../lib/billing.trpc';
import { openReceiptPdf } from '../lib/receipt-prefs';
import { usePermission } from '../hooks/usePermission';
import { useAuth } from '../providers/AuthProvider';
import { SURGERY_BILLING_ROLES } from '@airmed/contracts';
import { useLocale } from '../providers/LocaleProvider';

export function InvoiceDetailPage() {
  const { t } = useTranslation(['billing', 'common']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { locale } = useLocale();
  const { user } = useAuth();

  const canPay = usePermission('action:payment.create');
  // İade 2-aşama: doğrudan iade (yönetici) veya pending talep (resepsiyon/asistan).
  const canRefundDirect = usePermission('action:payment.refund');
  const canRefundRequest = usePermission('action:payment.refundRequest');
  const canRefundAny = canRefundDirect || canRefundRequest;
  const canCancel = usePermission('action:invoice.cancel');

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [refundForPayment, setRefundForPayment] = useState<PaymentRow | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const invoiceQuery = billingApi.findInvoice.useQuery({ id: id ?? '' }, { enabled: !!id });

  const dateFmt = getDateTimeFormat(localeToIntl(locale) ?? 'tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (invoiceQuery.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('billing:invoice.details')} />
        <p className="text-sm text-muted-foreground">{t('common:states.loading')}</p>
      </div>
    );
  }

  if (invoiceQuery.error || !invoiceQuery.data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('billing:invoice.details')} />
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {invoiceQuery.error?.message ?? 'Fatura bulunamadı'}
        </div>
      </div>
    );
  }

  const invoice = invoiceQuery.data;
  const isClosed =
    invoice.status === 'paid' || invoice.status === 'cancelled' || invoice.status === 'refunded';
  // Cerrahi-bağlı fatura (S12a): yalnız SURGERY_BILLING_ROLES tahsilat/iade yapar.
  // Diğer rollerde fatura görünür ama aksiyonlar GİZLİ (disabled değil) — Bölüm 14.
  const surgeryBound = invoice.surgeryId != null;
  const canSurgeryBilling =
    user?.roles.some((r) => (SURGERY_BILLING_ROLES as readonly string[]).includes(r)) ?? false;
  const surgeryBlocked = surgeryBound && !canSurgeryBilling;
  // Bakiye faturanın KENDİ para biriminde hesaplanır (backend recomputeStatus ile
  // birebir). Önceden tjsEquivalent (TJS) toplanıp USD total'dan çıkarılıyordu →
  // USD faturada "−$5.000" gibi saçma bakiye. payment.currency == invoice.currency
  // ise amount; değilse amount × exchangeRate ile invoice birimine indirgenir.
  const toInvoiceCcy = (amount: string, ccy: 'TJS' | 'USD', rate: string) =>
    ccy === invoice.currency ? parseFloat(amount) : parseFloat(amount) * parseFloat(rate);
  const paid = invoice.payments.reduce((sum, p) => {
    const refunded = p.refunds.reduce(
      (rs, r) => rs + toInvoiceCcy(r.amount, r.currency, p.exchangeRate),
      0,
    );
    return sum + toInvoiceCcy(p.amount, p.currency, p.exchangeRate) - refunded;
  }, 0);
  const total = parseFloat(invoice.total);
  const openBalance = total - paid;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${t('billing:invoice.number')}: ${invoice.invoiceNumber}`}
        description={`${invoice.patient.firstName} ${invoice.patient.lastName} · ${invoice.patient.mrn}`}
        actions={
          <div className="flex items-center gap-2">
            {/* S11e — Makbuz PDF: authlu blob fetch ile yeni sekmede aç (düz
                anchor navigasyonu Authorization header taşımadığından 401 verir) */}
            <Button
              variant="outline"
              size="sm"
              title={t('billing:invoice.details')}
              onClick={() =>
                openReceiptPdf(invoice.id, () =>
                  toast.error(
                    t('billing:payment.receiptError', { defaultValue: 'Makbuz açılamadı' }),
                  ),
                )
              }
            >
              <Download className="mr-1 h-4 w-4" />
              Makbuz PDF
            </Button>
            {canPay && !surgeryBlocked && !isClosed && invoice.status !== 'pending_approval' && (
              <Button size="sm" onClick={() => setPaymentOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                {t('billing:payment.addPayment')}
              </Button>
            )}
            {invoice.status === 'pending_approval' && (
              <Badge variant="info">{t('billing:invoice.statusLabel.pending_approval')}</Badge>
            )}
            {canCancel && invoice.status === 'open' && invoice.payments.length === 0 && (
              <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>
                <Ban className="mr-1 h-4 w-4" />
                {t('billing:invoice.cancel')}
              </Button>
            )}
          </div>
        }
      />

      {/* Status + summary */}
      <section className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">{t('billing:invoice.status')}</div>
          <span
            className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
              INVOICE_STATUS_COLORS[invoice.status as InvoiceStatus]
            }`}
          >
            {t(`billing:invoice.statusLabel.${invoice.status}`)}
          </span>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">{t('billing:invoice.total')}</div>
          <div className="text-lg font-semibold tabular-nums">
            {formatMoney(invoice.total, invoice.currency, localeToIntl(locale))}
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">{t('billing:invoice.paid')}</div>
          <div className="text-lg font-semibold tabular-nums text-success-foreground">
            {formatMoney(paid, invoice.currency, localeToIntl(locale))}
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">{t('billing:invoice.open')}</div>
          <div
            className={`text-lg font-semibold tabular-nums ${
              openBalance > 0 ? 'text-warning-foreground' : 'text-muted-foreground'
            }`}
          >
            {formatMoney(openBalance, invoice.currency, localeToIntl(locale))}
          </div>
        </div>
      </section>

      {invoice.cancelledAt && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <strong>{t('billing:invoice.cancel')}</strong> ·{' '}
          {dateFmt.format(new Date(invoice.cancelledAt))}
          {invoice.cancelReason && (
            <div className="mt-1 text-muted-foreground">{invoice.cancelReason}</div>
          )}
        </div>
      )}

      {surgeryBlocked && (
        <div
          role="note"
          className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('billing:invoice.surgeryBoundNote')}</span>
        </div>
      )}

      {/* Items */}
      <section className="rounded-lg border p-4">
        <h3 className="mb-3 text-sm font-medium">{t('billing:invoice.items')}</h3>
        <Table className="w-full text-sm">
          <TableHeader>
            <TableRow className="border-b text-xs uppercase text-muted-foreground">
              <TableHead className="py-2 text-left">{t('billing:invoice.description')}</TableHead>
              <TableHead className="py-2 text-right">{t('billing:invoice.quantity')}</TableHead>
              <TableHead className="py-2 text-right">{t('billing:invoice.unitPrice')}</TableHead>
              <TableHead className="py-2 text-right">{t('billing:invoice.lineTotal')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.items.map((it) => (
              <TableRow key={it.id} className="border-b last:border-0">
                <TableCell className="py-2">{it.description}</TableCell>
                <TableCell className="py-2 text-right tabular-nums">{it.quantity}</TableCell>
                <TableCell className="py-2 text-right tabular-nums">
                  {formatMoney(it.unitPrice, invoice.currency, localeToIntl(locale))}
                </TableCell>
                <TableCell className="py-2 text-right font-medium tabular-nums">
                  {formatMoney(it.lineTotal, invoice.currency, localeToIntl(locale))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <tfoot>
            <TableRow className="text-sm">
              <TableCell colSpan={3} className="py-2 text-right text-muted-foreground">
                {t('billing:invoice.subtotal')}
              </TableCell>
              <TableCell className="py-2 text-right tabular-nums">
                {formatMoney(invoice.subtotal, invoice.currency, localeToIntl(locale))}
              </TableCell>
            </TableRow>
            {parseFloat(invoice.discount) > 0 && (
              <TableRow className="text-sm">
                <TableCell colSpan={3} className="py-1 text-right text-muted-foreground">
                  {t('billing:invoice.discount')}
                </TableCell>
                <TableCell className="py-1 text-right tabular-nums">
                  −{formatMoney(invoice.discount, invoice.currency, localeToIntl(locale))}
                </TableCell>
              </TableRow>
            )}
            <TableRow className="text-base font-semibold">
              <TableCell colSpan={3} className="py-2 text-right">
                {t('billing:invoice.total')}
              </TableCell>
              <TableCell className="py-2 text-right tabular-nums">
                {formatMoney(invoice.total, invoice.currency, localeToIntl(locale))}
              </TableCell>
            </TableRow>
          </tfoot>
        </Table>
      </section>

      {/* Payments */}
      <section className="rounded-lg border p-4">
        <h3 className="mb-3 text-sm font-medium">{t('billing:payment.title')}</h3>
        {invoice.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('billing:common.noPayments')}</p>
        ) : (
          <ul className="space-y-3">
            {invoice.payments.map((p) => (
              <li
                key={p.id}
                className={`rounded-lg border p-3 text-sm ${p.refundedAt ? 'bg-muted/30' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium tabular-nums">
                      <span className="mr-1">
                        <PaymentMethodIcon method={p.method as PaymentMethod} />
                      </span>
                      {formatMoney(p.amount, p.currency, localeToIntl(locale))}
                      {p.currency !== invoice.currency && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (kur {p.exchangeRate} →{' '}
                          {formatMoney(p.tjsEquivalent, 'TJS', localeToIntl(locale))})
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {dateFmt.format(new Date(p.takenAt))} · {p.takenBy?.name ?? '—'}
                      {p.referenceNumber && ` · ${p.referenceNumber}`}
                    </div>
                  </div>
                  {canRefundAny && !surgeryBlocked && !p.refundedAt && (
                    <Button size="sm" variant="outline" onClick={() => setRefundForPayment(p)}>
                      <RotateCcw className="mr-1 h-3 w-3" />
                      {canRefundDirect
                        ? t('billing:refund.addRefund')
                        : t('billing:refund.requestSubmit')}
                    </Button>
                  )}
                </div>
                {p.notes && <div className="mt-1 text-xs text-muted-foreground">{p.notes}</div>}
                {p.refunds.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t pt-2">
                    {p.refunds.map((r: RefundRow) => (
                      <li
                        key={r.id}
                        className="flex items-start gap-1 text-xs text-critical-foreground"
                      >
                        <Undo2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                        <span className="tabular-nums">
                          {formatMoney(r.amount, r.currency, localeToIntl(locale))} —{' '}
                          {dateFmt.format(new Date(r.refundedAt))} ({r.approvedBy?.name ?? '—'}):{' '}
                          {r.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {paymentOpen && (
        <PaymentDialog
          invoiceId={invoice.id}
          invoiceCurrency={invoice.currency}
          openBalance={openBalance}
          onClose={() => setPaymentOpen(false)}
          onSuccess={() => {
            toast.success(t('billing:payment.addedToast', { amount: '' }));
            void invoiceQuery.refetch();
            setPaymentOpen(false);
          }}
        />
      )}

      {refundForPayment && (
        <RefundDialog
          payment={refundForPayment}
          invoiceCurrency={invoice.currency}
          onClose={() => setRefundForPayment(null)}
          onSuccess={() => {
            // Mod-bazlı toast (doğrudan iade / pending talep) RefundDialog içinde atılır.
            void invoiceQuery.refetch();
            setRefundForPayment(null);
          }}
        />
      )}

      {cancelOpen && (
        <CancelInvoiceDialog
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoiceNumber}
          onClose={() => setCancelOpen(false)}
          onSuccess={() => {
            toast.success(t('billing:invoice.cancelledToast'));
            void invoiceQuery.refetch();
            setCancelOpen(false);
            navigate('/billing');
          }}
        />
      )}
    </div>
  );
}
