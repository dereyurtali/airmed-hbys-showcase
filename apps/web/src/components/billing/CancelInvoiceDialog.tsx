import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { confirmIfDirty } from '../../hooks/useUnsavedWarning';
import { billingApi, type InvoiceRow } from '../../lib/billing.trpc';

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  onClose: () => void;
  onSuccess: () => void;
}

const looseMutation = billingApi.cancelInvoice as unknown as {
  useMutation: (opts?: {
    onSuccess?: (data: InvoiceRow) => void;
    onError?: (err: { message: string }) => void;
  }) => { mutate: (input: { id: string; reason: string }) => void; isPending: boolean };
};

export function CancelInvoiceDialog({ invoiceId, invoiceNumber, onClose, onSuccess }: Props) {
  const { t } = useTranslation(['billing', 'common']);
  const [reason, setReason] = useState('');

  const mutation = looseMutation.useMutation({
    onSuccess: () => onSuccess(),
    onError: (err) => toast.error(err.message ?? 'Hata'),
  });

  const dirty = reason !== '';
  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (!confirmIfDirty(dirty, t('common:forms.unsavedConfirm'))) return;
    onClose();
  };

  const onSubmit = () =>
    reason.trim().length >= 10
      ? mutation.mutate({ id: invoiceId, reason: reason.trim() })
      : toast.error('Sebep en az 10 karakter');

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle className="mb-4">{t('billing:invoice.cancel')}</DialogTitle>

        <p className="mb-3 text-sm text-muted-foreground">
          {t('billing:invoice.number')}: <span className="font-mono">{invoiceNumber}</span>
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div>
            <Label>{t('billing:invoice.cancelReason')}</Label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              minLength={10}
              maxLength={500}
              required
              autoFocus
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">{reason.length} / 500</p>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={mutation.isPending || reason.trim().length < 10}
            >
              {t('billing:invoice.cancel')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
