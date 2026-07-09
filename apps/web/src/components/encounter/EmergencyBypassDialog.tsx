import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  encounterId: string;
  mode: 'activate' | 'close';
  onCompleted?: () => void;
}

/**
 * S15-PR5 — Break Glass acil bypass dialog. Sadece yönetici görür
 * (PermissionGuard route + UI gate). Aktivasyon sebep ≥10 char zorunlu;
 * close akışı sebep istemez. Submit sonrası encounter state değişir;
 * "önce öde" kuralı bypass aktifken atlanır.
 */
export function EmergencyBypassDialog({
  open,
  onOpenChange,
  encounterId,
  mode,
  onCompleted,
}: Props) {
  const { t } = useTranslation(['encounter', 'common']);
  const utils = trpc.useUtils();
  const [reason, setReason] = useState('');

  // #1066 — tüm encounter router'ı yerine bypass'ın etkilediği yüzeyler:
  // hasta bandı (activeForPatient) + kuyruk ekranları.
  const invalidateAffected = () => {
    void utils.encounter.activeForPatient.invalidate();
    void utils.encounter.receptionQueue.invalidate();
    void utils.encounter.waitingMonitor.invalidate();
  };

  const activate = trpc.encounter.activateEmergencyBypass.useMutation({
    onSuccess: () => {
      invalidateAffected();
      toast.success(t('encounter:bypass.activated'));
      setReason('');
      onCompleted?.();
      onOpenChange(false);
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });
  const close = trpc.encounter.closeEmergencyBypass.useMutation({
    onSuccess: () => {
      invalidateAffected();
      toast.success(t('encounter:bypass.closed'));
      onCompleted?.();
      onOpenChange(false);
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'activate') {
      if (reason.trim().length < 10) {
        toast.error(t('encounter:bypass.reasonTooShort'));
        return;
      }
      activate.mutate({ id: encounterId, reason: reason.trim() });
    } else {
      close.mutate({ id: encounterId });
    }
  };

  const isPending = activate.isPending || close.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="flex items-center gap-2 text-warning-foreground">
          <AlertCircle className="h-5 w-5" />
          {mode === 'activate'
            ? t('encounter:bypass.activateTitle')
            : t('encounter:bypass.closeTitle')}
        </DialogTitle>
        <DialogDescription>
          {mode === 'activate'
            ? t('encounter:bypass.activateDescription')
            : t('encounter:bypass.closeDescription')}
        </DialogDescription>

        <form onSubmit={submit} className="mt-4 space-y-3">
          {mode === 'activate' && (
            <div className="space-y-1.5">
              <Label htmlFor="bypass-reason">
                {t('encounter:bypass.reasonLabel')} <span className="text-destructive">*</span>
              </Label>
              <textarea
                id="bypass-reason"
                className="focus-ring flex w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
                rows={4}
                minLength={10}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('encounter:bypass.reasonPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {t('encounter:bypass.reasonHint', { count: reason.length })}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              type="submit"
              variant={mode === 'activate' ? 'destructive' : 'default'}
              disabled={isPending || (mode === 'activate' && reason.trim().length < 10)}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'activate'
                ? t('encounter:bypass.activateSubmit')
                : t('encounter:bypass.closeSubmit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
