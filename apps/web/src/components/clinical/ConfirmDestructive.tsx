import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';

/**
 * Geri-dönüşsüz aksiyon teyidi — airmed-design Ray 3. shadcn `<AlertDialog>` projede yok →
 * `<Dialog>` + type-to-confirm fallback. Yüksek-risk (hasta/ödeme/kayıt silme) için
 * `requirePhrase` (kullanıcı "SİL" yazar) + opsiyonel gerekçe + başarı sonrası geri-al toast.
 * native `confirm()` YASAK. Basit evet/hayır için `ui/ConfirmDialog` yeterli; bu, ağır risk içindir.
 */

interface ConfirmDestructiveProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Type-to-confirm ifadesi (default i18n "SİL"). `requirePhrase=false` ise yazma istenmez. */
  confirmPhrase?: string;
  requirePhrase?: boolean;
  reasonRequired?: boolean;
  reasonMinLength?: number;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Harici pending (mutation). İçeride de await edilirse otomatik spinner gösterilir. */
  pending?: boolean;
  onConfirm: (ctx: { reason: string }) => void | Promise<void>;
  /** Başarı sonrası geri-al toast'u (Sonner action ~6sn). */
  undoToast?: {
    message: string;
    actionLabel?: string;
    onUndo: () => void;
    durationMs?: number;
  };
}

export function ConfirmDestructive({
  open,
  onOpenChange,
  title,
  description,
  confirmPhrase,
  requirePhrase = true,
  reasonRequired = false,
  reasonMinLength = 10,
  confirmLabel,
  cancelLabel,
  pending = false,
  onConfirm,
  undoToast,
}: ConfirmDestructiveProps) {
  const { t } = useTranslation(['clinical', 'common']);
  const phrase = confirmPhrase ?? t('clinical:confirm.defaultPhrase');
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setTyped('');
      setReason('');
      setSubmitting(false);
    }
  }, [open]);

  const phraseOk = !requirePhrase || typed.trim() === phrase;
  const reasonOk = !reasonRequired || reason.trim().length >= reasonMinLength;
  const busy = pending || submitting;
  const canConfirm = phraseOk && reasonOk && !busy;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    try {
      setSubmitting(true);
      await onConfirm({ reason: reason.trim() });
      if (undoToast) {
        toast(undoToast.message, {
          action: {
            label: undoToast.actionLabel ?? t('clinical:confirm.undo'),
            onClick: undoToast.onUndo,
          },
          duration: undoToast.durationMs ?? 6000,
        });
      }
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md" role="alertdialog">
        <DialogTitle className="text-destructive">{title}</DialogTitle>
        {description && <DialogDescription className="mt-1">{description}</DialogDescription>}

        <div className="mt-4 space-y-3">
          {requirePhrase && (
            <div className="space-y-1.5">
              <Label htmlFor="confirm-destructive-phrase">
                {t('clinical:confirm.typePrompt', { phrase })}
              </Label>
              <input
                id="confirm-destructive-phrase"
                type="text"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={phrase}
                className="focus-ring flex h-11 w-full rounded-lg border border-field bg-background px-3 py-2 font-mono text-sm hover:border-field-hover"
                data-testid="confirm-destructive-input"
              />
            </div>
          )}

          {reasonRequired && (
            <div className="space-y-1.5">
              <Label htmlFor="confirm-destructive-reason">
                {t('clinical:confirm.reasonLabel')}
              </Label>
              <textarea
                id="confirm-destructive-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder={t('clinical:confirm.reasonPlaceholder', { min: reasonMinLength })}
                className="focus-ring flex w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
                data-testid="confirm-destructive-reason"
              />
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="outline"
            size="touch"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            data-testid="confirm-destructive-cancel"
          >
            {cancelLabel ?? t('common:actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="touch"
            disabled={!canConfirm}
            onClick={handleConfirm}
            data-testid="confirm-destructive-submit"
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel ?? t('clinical:confirm.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
