import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Barcode } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import { Input } from '../ui/input';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';

// S15 — Intra-op lens kayıt (registerLens) UI. Backend B1 PR2 hazır;
// SurgeryDayCenterPage'den çağrılır. Barkod scanner input box odaklı +
// manuel serial number fallback. Override checkbox + sebep textarea (B1 kuralı).

interface Props {
  surgeryId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSuccess?: () => void;
}

// Delta audit A-1: tRPC mutation kullanımı `trpc.surgery.registerLens` üzerinden.
// useMutation options object'i `AppRouter` derinliğinde "Type instantiation
// excessively deep" hatasına yol açtığı için (denetim P1 #3.25), options sade
// `useMutation` ile bağlanır; `mutate` çağrısı tip-güvenli.

export function LensRegisterDialog({ surgeryId, open, onOpenChange, onSuccess }: Props) {
  const { t } = useTranslation('surgery');
  const [serialNumber, setSerialNumber] = useState('');
  const [barcode, setBarcode] = useState('');
  const [isOverride, setIsOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  const mutation = trpc.surgery.registerLens.useMutation();

  const resetForm = () => {
    setSerialNumber('');
    setBarcode('');
    setIsOverride(false);
    setOverrideReason('');
  };

  const handleSuccess = () => {
    toast.success(t('lensRegister.success'));
    onOpenChange(false);
    resetForm();
    onSuccess?.();
  };

  const handleError = (err: unknown) => toast.error(mapTrpcError(err, t));

  const canSubmit =
    /^[A-Z0-9-]{6,20}$/.test(serialNumber) &&
    (!isOverride || overrideReason.trim().length >= 10) &&
    !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('lensRegister.title')}</DialogTitle>
        <DialogDescription>{t('lensRegister.description')}</DialogDescription>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              <Barcode className="mr-1 inline h-3.5 w-3.5" />
              {t('lensRegister.barcodeLabel')}
            </span>
            <Input
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder={t('lensRegister.barcodePlaceholder')}
              autoFocus
              data-testid="lens-barcode"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              {t('lensRegister.serialLabel')} <span className="text-destructive">*</span>
            </span>
            <Input
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value.toUpperCase())}
              placeholder={t('lensRegister.serialPlaceholder')}
              pattern="^[A-Z0-9-]{6,20}$"
              data-testid="lens-serial"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Regex: ^[A-Z0-9-]{`{6,20}`}$
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isOverride}
              onChange={(e) => setIsOverride(e.target.checked)}
              data-testid="lens-override"
            />
            {t('lensRegister.overrideLabel')}
          </label>

          {isOverride && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">
                {t('lensRegister.overrideReasonLabel')}
              </span>
              <textarea
                className="min-h-[60px] w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                minLength={10}
                maxLength={500}
                data-testid="lens-override-reason"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {overrideReason.trim().length}/500
              </span>
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('lensRegister.cancel')}
            </Button>
            <Button
              disabled={!canSubmit}
              onClick={() =>
                mutation.mutate(
                  {
                    surgeryId,
                    serialNumber,
                    barcode: barcode.trim() || null,
                    isOverride,
                    overrideReason: isOverride ? overrideReason.trim() : null,
                  },
                  { onSuccess: handleSuccess, onError: handleError },
                )
              }
              data-testid="lens-submit"
            >
              {t('lensRegister.submit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
