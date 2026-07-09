import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DateTimeField } from '../ui/date-field';
import { Label } from '../ui/label';
import { api } from '../../lib/api';
import {
  ALLOWED_PHOTO_MIMES,
  formatBytes,
  MAX_PHOTO_BYTES,
  PHOTO_TAGS,
  type PhotoTag,
} from '../../lib/photo.constants';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  onUploaded: () => void;
  /** Etiket seçicinin başlangıç değeri (örn. ölçüm istasyonu 'device_output' preset eder). */
  defaultTag?: PhotoTag;
}

export function PhotoUpload({
  open,
  onOpenChange,
  patientId,
  onUploaded,
  defaultTag = 'general',
}: Props) {
  const { t } = useTranslation(['photo', 'common']);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [tag, setTag] = useState<PhotoTag>(defaultTag);
  const [description, setDescription] = useState('');
  const [takenAt, setTakenAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormError(null);
    const selected = e.target.files?.[0] ?? null;
    if (!selected) {
      setFile(null);
      return;
    }
    if (!ALLOWED_PHOTO_MIMES.includes(selected.type.toLowerCase())) {
      setFormError(t('photo:errors.mimeNotAllowed'));
      setFile(null);
      return;
    }
    if (selected.size > MAX_PHOTO_BYTES) {
      setFormError(t('photo:errors.tooLarge'));
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const reset = () => {
    setFile(null);
    setTag(defaultTag);
    setDescription('');
    setTakenAt('');
    setFormError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!file) {
      setFormError(t('photo:errors.noFile'));
      return;
    }

    const fd = new FormData();
    fd.append('file', file);
    fd.append('patientId', patientId);
    fd.append('tag', tag);
    if (description.trim()) fd.append('description', description.trim());
    if (takenAt) fd.append('takenAt', new Date(takenAt).toISOString());

    setSubmitting(true);
    try {
      await api.post('/photos/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(t('photo:toast.uploaded'));
      reset();
      onUploaded();
      onOpenChange(false);
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { message?: string } }; message?: string };
      const msg = errObj.response?.data?.message ?? errObj.message ?? t('photo:errors.unknown');
      setFormError(t('photo:errors.uploadFailed', { message: msg }));
      toast.error(t('photo:errors.uploadFailed', { message: msg }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogTitle>{t('photo:upload.title')}</DialogTitle>
        <DialogDescription>{t('photo:upload.description')}</DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="photo-file">{t('photo:upload.fileLabel')}</Label>
            <Input
              id="photo-file"
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_PHOTO_MIMES.join(',')}
              onChange={onFileChange}
              required
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {t('photo:upload.selected', { name: file.name, size: formatBytes(file.size) })}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="photo-tag">{t('photo:upload.tag')}</Label>
              <select
                id="photo-tag"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={tag}
                onChange={(e) => setTag(e.target.value as PhotoTag)}
              >
                {PHOTO_TAGS.map((g) => (
                  <option key={g} value={g}>
                    {t(`photo:tag.${g}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="photo-takenAt">{t('photo:upload.takenAt')}</Label>
              <DateTimeField id="photo-takenAt" value={takenAt} onChange={setTakenAt} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="photo-description">{t('photo:upload.descriptionLabel')}</Label>
            <textarea
              id="photo-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={submitting || !file}>
              {submitting ? t('photo:upload.submitting') : t('photo:upload.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
