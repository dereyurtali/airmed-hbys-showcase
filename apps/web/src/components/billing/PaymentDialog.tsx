import { localeToIntl } from '../../lib/i18n-format';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { confirmIfDirty } from '../../hooks/useUnsavedWarning';
import { CURRENCIES, PAYMENT_METHODS, formatMoney } from '../../lib/billing.constants';
import type { Currency, PaymentMethod } from '../../lib/billing.constants';
import { billingApi, type PaymentRow } from '../../lib/billing.trpc';
import { useLocale } from '../../providers/LocaleProvider';
import { getReceiptAutoprintMode, openReceiptPdf, printReceipt } from '../../lib/receipt-prefs';

interface Props {
  invoiceId: string;
  invoiceCurrency: Currency;
  openBalance: number; // invoice currency birimine
  onClose: () => void;
  onSuccess: () => void;
  // Resepsiyon kokpitinden zincir başlatıldıysa: tahsilat başarıdan sonra
  // (1) kullanıcı tercihine göre makbuz yeni sekmede açılır, (2) onPaid çağrılır.
  // Mevcut çağıranlar (InvoiceDetailPage, PatientInvoicesSection) bunu geçmez —
  // eski davranış aynen kalır.
  onPaid?: (payment: PaymentRow) => void;
}

const looseMutation = billingApi.createPayment as unknown as {
  useMutation: (opts?: {
    onSuccess?: (data: PaymentRow) => void;
    onError?: (err: { message: string }) => void;
  }) => { mutate: (input: unknown) => void; isPending: boolean };
};

export function PaymentDialog({
  invoiceId,
  invoiceCurrency,
  openBalance,
  onClose,
  onSuccess,
  onPaid,
}: Props) {
  const { t } = useTranslation(['billing', 'common']);
  const { locale } = useLocale();

  const initialAmount = openBalance > 0 ? openBalance.toFixed(2) : '';
  const [amount, setAmount] = useState(initialAmount);
  const [currency, setCurrency] = useState<Currency>(invoiceCurrency);
  // #419b — kur NBT'den (billing.currentRate); kayıt yoksa legacy fallback 11.00.
  const rateQuery = billingApi.currentRate.useQuery(undefined);
  const [exchangeRate, setExchangeRate] = useState('11.00');
  const [rateTouched, setRateTouched] = useState(false);
  useEffect(() => {
    if (!rateTouched && rateQuery.data?.rate) setExchangeRate(rateQuery.data.rate);
  }, [rateQuery.data?.rate, rateTouched]);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const mutation = looseMutation.useMutation({
    onSuccess: (payment) => {
      if (onPaid) {
        const mode = getReceiptAutoprintMode();
        if (mode === 'auto') {
          void printReceipt(invoiceId).catch(() =>
            toast.error(t('billing:payment.receiptError', { defaultValue: 'Makbuz açılamadı' })),
          );
        } else {
          toast.success(t('billing:payment.addedReceiptManual'), {
            action: {
              label: t('billing:payment.receiptOpen'),
              onClick: () =>
                openReceiptPdf(invoiceId, () =>
                  toast.error(
                    t('billing:payment.receiptError', { defaultValue: 'Makbuz açılamadı' }),
                  ),
                ),
            },
          });
        }
        onPaid(payment);
      }
      onSuccess();
    },
    onError: (err) => toast.error(err.message ?? 'Hata'),
  });

  const dirty =
    amount !== initialAmount ||
    currency !== invoiceCurrency ||
    method !== 'cash' ||
    reference !== '' ||
    notes !== '';
  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (!confirmIfDirty(dirty, t('common:forms.unsavedConfirm'))) return;
    onClose();
  };

  const needsExchangeRate = currency !== invoiceCurrency;

  const onSubmit = () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Tutar > 0 olmalı');
      return;
    }
    mutation.mutate({
      invoiceId,
      amount,
      currency,
      ...(needsExchangeRate && { exchangeRate }),
      method,
      referenceNumber: reference || null,
      notes: notes || null,
    });
  };

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle className="mb-4">{t('billing:payment.addPayment')}</DialogTitle>

        <div className="mb-4 rounded-lg bg-muted/30 p-3 text-sm">
          <div className="text-xs text-muted-foreground">{t('billing:invoice.open')}</div>
          <div className="font-semibold tabular-nums">
            {formatMoney(openBalance, invoiceCurrency, localeToIntl(locale))}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="space-y-3">
            <div>
              <Label>{t('billing:payment.amount')}</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{t('billing:invoice.currency')}</Label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as Currency)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>{t('billing:payment.method')}</Label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`billing:payment.methods.${m}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {needsExchangeRate && (
              <div>
                <Label>{t('billing:payment.exchangeRate')}</Label>
                <Input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  value={exchangeRate}
                  onChange={(e) => {
                    setRateTouched(true);
                    setExchangeRate(e.target.value);
                  }}
                />
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {amount && exchangeRate && (
                    <>
                      {amount} {currency} ×{exchangeRate} ={' '}
                      {(parseFloat(amount) * parseFloat(exchangeRate)).toFixed(2)} TJS
                    </>
                  )}
                </p>
              </div>
            )}

            <div>
              <Label>{t('billing:payment.referenceNumber')}</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>

            <div>
              <Label>{t('billing:payment.notes')}</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {t('billing:payment.addPayment')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
