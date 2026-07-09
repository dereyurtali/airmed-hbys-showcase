import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: string; // JSON string
  rxId: string;
  supplierName: string | null;
}

export function PrescriptionQrModal({ open, onOpenChange, payload, rxId, supplierName }: Props) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    if (!open || !payload) return;
    let cancelled = false;
    void QRCode.toDataURL(payload, { width: 320, errorCorrectionLevel: 'M' }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [open, payload]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md text-center">
        <DialogTitle>{t('pharmacy:qr.title')}</DialogTitle>
        <DialogDescription>
          {supplierName
            ? t('pharmacy:qr.supplierHint', { name: supplierName })
            : t('pharmacy:qr.scanHint')}
        </DialogDescription>

        <div className="mx-auto mt-4 flex flex-col items-center gap-2">
          {dataUrl ? (
            <img
              src={dataUrl}
              alt={t('pharmacy:qr.altLabel')}
              className="rounded-md border bg-white p-2"
              width={320}
              height={320}
              data-testid="rx-qr-image"
            />
          ) : (
            <div className="h-[320px] w-[320px] animate-pulse rounded-md bg-muted" />
          )}
          <p className="text-xs text-muted-foreground">
            {t('pharmacy:qr.rxIdLabel')}: <span className="font-mono">{rxId.slice(0, 8)}</span>
          </p>
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:actions.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
