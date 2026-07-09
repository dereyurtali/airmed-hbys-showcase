import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ImageUp, Loader2, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { api } from '../../lib/api';

interface Props {
  /** Mevcut logoUrl (varsa) — `/api/clinic-settings/logo/file?tenantId=...&v=...`. */
  logoUrl: string | null;
  /** Upload veya delete sonrası parent invalidate çağırsın. */
  onChanged: (newLogoUrl: string | null) => void;
}

const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
const MAX_BYTES = 2 * 1024 * 1024;

export function LogoUploadField({ logoUrl, onChanged }: Props) {
  const { t } = useTranslation('common');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [imgErrored, setImgErrored] = useState(false);
  const previewSrc = logoUrl && !imgErrored ? logoUrl : null;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_MIMES.includes(file.type.toLowerCase())) {
      toast.error(t('clinicSettingsPage.logo.errors.mime'));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t('clinicSettingsPage.logo.errors.size'));
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{ logoUrl: string }>('/clinic-settings/logo', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImgErrored(false);
      onChanged(res.data.logoUrl);
      toast.success(t('clinicSettingsPage.logo.uploaded'));
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(e2.response?.data?.message ?? e2.message ?? t('errors.unexpected'));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await api.delete('/clinic-settings/logo');
      onChanged(null);
      toast.success(t('clinicSettingsPage.logo.removed'));
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(e2.response?.data?.message ?? e2.message ?? t('errors.unexpected'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
        {previewSrc ? (
          <img
            key={previewSrc}
            src={previewSrc}
            alt="logo"
            className="h-full w-full object-contain p-1"
            onError={() => setImgErrored(true)}
          />
        ) : (
          <img
            src="/airmed-logo.png"
            alt="AirMed default"
            className="h-full w-full object-contain p-2 opacity-70"
            draggable={false}
          />
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.5} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_MIMES.join(',')}
          onChange={handleFile}
          className="hidden"
          data-testid="logo-upload-input"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          data-testid="logo-upload-button"
        >
          <ImageUp className="mr-2 h-4 w-4" strokeWidth={1.5} />
          {previewSrc ? t('clinicSettingsPage.logo.replace') : t('clinicSettingsPage.logo.upload')}
        </Button>
        {previewSrc && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={busy}
            data-testid="logo-remove-button"
          >
            <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.5} />
            {t('clinicSettingsPage.logo.remove')}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">{t('clinicSettingsPage.logo.hint')}</p>
      </div>
    </div>
  );
}
