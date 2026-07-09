import { localeToIntl } from '../../lib/i18n-format';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { confirmIfDirty } from '../../hooks/useUnsavedWarning';
import { formatMoney, type Currency } from '../../lib/billing.constants';
import { billingApi, type PaymentRow, type RefundRow } from '../../lib/billing.trpc';
import { usePermission } from '../../hooks/usePermission';
import { useLocale } from '../../providers/LocaleProvider';

interface Props {
  payment: PaymentRow;
  invoiceCurrency: Currency;
  onClose: () => void;
  onSuccess: () => void;
}

type LooseRefundMutation = {
  useMutation: (opts?: {
    onSuccess?: (data: RefundRow) => void;
    onError?: (err: { message: string }) => void;
  }) => { mutate: (input: unknown) => void; isPending: boolean };
};

const directMutation = billingApi.createRefund as unknown as LooseRefundMutation;
const requestMutation = billingApi.requestRefund as unknown as LooseRefundMutation;

export function RefundDialog({ payment, onClose, onSuccess }: Props) {
  const { t } = useTranslation(['billing', 'common']);
  const { locale } = useLocale();

  // İade 2-aşama (S15-PR15b): yöneticide doğrudan iade (action:payment.refund);
  // resepsiyon/asistanda pending TALEP (action:payment.refundRequest). Yetkiye
  // göre endpoint + etiket değişir; backend zaten ayrı procedure ile zorlar.
  const canDirectRefund = usePermission('action:payment.refund');
  const isRequest = !canDirectRefund;

  const refundable =
    parseFloat(payment.amount) - payment.refunds.reduce((sum, r) => sum + parseFloat(r.amount), 0);

  const initialAmount = refundable.toFixed(2);
  const [amount, setAmount] = useState(initialAmount);
  const [reason, setReason] = useState('');

  const mutation = (isRequest ? requestMutation : directMutation).useMutation({
    onSuccess: () => {
      toast.success(
        isRequest ? t('billing:refund.requestedToast') : t('billing:refund.addedToast'),
      );
      onSuccess();
    },
    onError: (err) => toast.error(err.message ?? t('common:errors.unexpected')),
  });

  const dirty = amount !== initialAmount || reason !== '';
  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (!confirmIfDirty(dirty, t('common:forms.unsavedConfirm'))) return;
    onClose();
  };

  const onSubmit = () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error(t('billing:refund.amountInvalid'));
      return;
    }
    if (reason.trim().length < 10) {
      toast.error(t('billing:refund.reasonTooShort'));
      return;
    }
    mutation.mutate({ paymentId: payment.id, amount, reason: reason.trim() });
  };

  // Ray 4 — submit öncesi insan-okunur tutar özeti
  const amountSummary = formatMoney(
    parseFloat(amount || '0'),
    payment.currency,
    localeToIntl(locale),
  );

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle className="mb-4">
          {isRequest ? t('billing:refund.requestTitle') : t('billing:refund.title')}
        </DialogTitle>

        <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning-foreground" />
          <p className="text-warning-foreground">
            {isRequest ? t('billing:refund.requestWarning') : t('billing:refund.warning')}
          </p>
        </div>

        <div className="mb-4 rounded-lg bg-muted/30 p-3 text-sm">
          <div className="text-xs text-muted-foreground">{t('billing:refund.refundableLabel')}</div>
          <div className="font-semibold tabular-nums">
            {formatMoney(refundable, payment.currency, localeToIntl(locale))}
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
              <Label>{t('billing:refund.amount')}</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={refundable}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <Label>{t('billing:refund.reason')}</Label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                minLength={10}
                maxLength={500}
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">{reason.length} / 500</p>
            </div>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            {isRequest
              ? t('billing:refund.summaryRequest', { amount: amountSummary })
              : t('billing:refund.summaryDirect', { amount: amountSummary })}
          </p>

          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={mutation.isPending || reason.trim().length < 10}
            >
              {isRequest ? t('billing:refund.requestSubmit') : t('billing:refund.addRefund')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
