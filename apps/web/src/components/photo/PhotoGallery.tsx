import { localeToIntl } from '../../lib/i18n-format';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { AuthedImage } from './AuthedImage';
import { PhotoUpload } from './PhotoUpload';
import { usePermission } from '../../hooks/usePermission';
import { useConfirm } from '../../hooks/useConfirm';
import { formatBytes, type PhotoTag } from '../../lib/photo.constants';
import { trpc } from '../../lib/trpc';
import { useLocale } from '../../providers/LocaleProvider';

interface PhotoItem {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  tag: string;
  description: string | null;
  takenAt: string | Date | null;
  createdAt: string | Date;
  uploadedBy: { id: string; name: string } | null;
  uploadedById: string | null;
}

interface Props {
  patientId: string;
}

export function PhotoGallery({ patientId }: Props) {
  const { t } = useTranslation(['photo', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';
  const { confirm } = useConfirm();

  const me = trpc.auth.me.useQuery();
  const list = trpc.photo.listByPatient.useQuery({ patientId });
  const utils = trpc.useUtils();
  const softDelete = trpc.photo.softDelete.useMutation({
    onSuccess: async () => {
      await utils.photo.listByPatient.invalidate({ patientId });
    },
  });

  const [uploadOpen, setUploadOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const photos = (list.data as PhotoItem[] | undefined) ?? [];
  // S10a — Permission registry (P1 #3.31): hardcode role check kaldırıldı.
  // action:photo.delete sadece yönetici (karar tutanağı §6.2). Kendi yüklediği
  // foto için her zaman silebilir — owner-bazlı içsel kural, permission'ın üstünde.
  const canAdminDelete = usePermission('action:photo.delete');
  // #663 — yükleme yalnız klinik personeli (action:photo.upload = [doktor, hemsire]);
  // backend de gate'li. Galeriyi görebilen ama yükleyemeyen rollerde (yönetici/asistan)
  // buton gizli — 403 buton gösterme.
  const canUpload = usePermission('action:photo.upload');
  const myId = me.data?.sub;

  const canDelete = (p: PhotoItem) => canAdminDelete || (myId && p.uploadedById === myId);

  // Lightbox keyboard nav
  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIdx(null);
      if (e.key === 'ArrowRight' && lightboxIdx < photos.length - 1)
        setLightboxIdx(lightboxIdx + 1);
      if (e.key === 'ArrowLeft' && lightboxIdx > 0) setLightboxIdx(lightboxIdx - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIdx, photos.length]);

  const fmtDate = (iso: string | Date | null) => {
    if (!iso) return '';
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    return d.toLocaleString(dateLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm({ message: t('photo:actions.confirmDelete'), destructive: true }))) return;
    softDelete.mutate({ id });
  };

  return (
    <section className="space-y-3" aria-labelledby="photo-heading">
      <header className="flex items-center justify-between">
        <h2 id="photo-heading" className="text-lg font-semibold">
          {t('photo:section.title')}
        </h2>
        {canUpload && (
          <Button size="sm" onClick={() => setUploadOpen(true)} data-testid="photo-new">
            <Plus className="mr-1 h-4 w-4" />
            {t('photo:section.newButton')}
          </Button>
        )}
      </header>

      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('photo:section.loading')}</p>
      ) : list.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {list.error.message}
        </p>
      ) : photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('photo:section.empty')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p, idx) => (
            <li
              key={p.id}
              className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
            >
              <button
                type="button"
                onClick={() => setLightboxIdx(idx)}
                className="block h-full w-full"
                aria-label={p.fileName}
              >
                <AuthedImage
                  photoId={p.id}
                  alt={p.description ?? p.fileName}
                  loading="lazy"
                  className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                />
              </button>
              <span className="absolute left-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white">
                {t(`photo:tag.${p.tag as PhotoTag}`)}
              </span>
              {canDelete(p) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDelete(p.id);
                  }}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                  aria-label={t('photo:actions.delete')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {uploadOpen && (
        <PhotoUpload
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          patientId={patientId}
          onUploaded={async () => {
            await utils.photo.listByPatient.invalidate({ patientId });
          }}
        />
      )}

      {lightboxIdx !== null && photos[lightboxIdx] && (
        <Lightbox
          photoId={photos[lightboxIdx]!.id}
          alt={photos[lightboxIdx]!.fileName}
          caption={
            <div className="space-y-0.5 text-xs text-white/80">
              <div>{photos[lightboxIdx]!.fileName}</div>
              <div>
                {t(`photo:tag.${photos[lightboxIdx]!.tag as PhotoTag}`)} ·{' '}
                {formatBytes(photos[lightboxIdx]!.sizeBytes)} ·{' '}
                {fmtDate(photos[lightboxIdx]!.takenAt ?? photos[lightboxIdx]!.createdAt)}
              </div>
              {photos[lightboxIdx]!.description && (
                <div className="italic">{photos[lightboxIdx]!.description}</div>
              )}
            </div>
          }
          hasPrev={lightboxIdx > 0}
          hasNext={lightboxIdx < photos.length - 1}
          onPrev={() => setLightboxIdx((i) => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setLightboxIdx((i) => (i !== null && i < photos.length - 1 ? i + 1 : i))}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </section>
  );
}

interface LightboxProps {
  photoId: string;
  alt: string;
  caption: React.ReactNode;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

function Lightbox({
  photoId,
  alt,
  caption,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
}: LightboxProps) {
  const { t } = useTranslation('photo');
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        aria-label={t('lightbox.close')}
      >
        <X className="h-5 w-5" />
      </button>
      {hasPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          aria-label={t('lightbox.prev')}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          aria-label={t('lightbox.next')}
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
      <figure
        className="flex max-h-[90vh] max-w-[90vw] flex-col gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <AuthedImage
          photoId={photoId}
          alt={alt}
          className="max-h-[85vh] max-w-full rounded object-contain"
        />
        <figcaption>{caption}</figcaption>
      </figure>
    </div>
  );
}
