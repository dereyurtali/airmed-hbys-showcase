import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';

/**
 * R4 (#726) — Onay-reddi gerekçe dialog'u. İndirim / Satın Alma reddinde ortak;
 * native `window.prompt()` yerine (airmed-design Ray 3: native prompt yasak).
 * Gerekçe opsiyonel + talep edene iletilir; reddet = destructive. role=alertdialog.
 */
export function ApprovalRejectDialog({
  open,
  onOpenChange,
  onConfirm,
  pending = false,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string | null) => void;
  pending?: boolean;
  title?: string;
}) {
  const { t } = useTranslation('common');
  const [reason, setReason] = useState('');

  // Her açılışta temiz başla (önceki redden artık gerekçe taşınmasın).
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" role="alertdialog">
        <DialogTitle>{title ?? t('approvalReject.title')}</DialogTitle>
        <DialogDescription className="mt-1">{t('approvalReject.description')}</DialogDescription>

        <div className="mt-4 space-y-1.5">
          <Label htmlFor="approval-reject-reason">{t('approvalReject.reasonLabel')}</Label>
          <textarea
            id="approval-reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            autoFocus
            placeholder={t('approvalReject.reasonPlaceholder')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">{reason.length} / 500</p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="outline"
            size="touch"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t('actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="touch"
            onClick={() => onConfirm(reason.trim() || null)}
            disabled={pending}
          >
            {t('approvalReject.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
