import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, FileUp, Loader2, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { FormField } from '../form/FormField';
import { api } from '../../lib/api';
import { formatBytes } from '../../lib/photo.constants';
import { formatDateTime } from '../../lib/i18n-format';
import { trpc } from '../../lib/trpc';
import { useConfirm } from '../../hooks/useConfirm';
import { useLocale } from '../../providers/LocaleProvider';
import { usePermission } from '../../hooks/usePermission';
import { cn } from '../../lib/utils';

// #1050 — Personel dökümanları (CV/diploma/sertifika/sözleşme). İç İK verisi:
// hasta-facing hiçbir yüzeye çıkmaz (KVKK sınırı EPIC #1052 Karar 3).
// Upload/serve/delete REST (multipart + auth'lu stream); liste tRPC metadata.

const DOC_TYPES = ['cv', 'diploma', 'sertifika', 'sozlesme', 'diger'] as const;
type DocType = (typeof DOC_TYPES)[number];

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const SELECT_CLASS =
  'focus-ring flex h-10 w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Dosyayı auth'lu blob olarak yeni sekmede açar. Düz <a href> Authorization
 * header taşımadığı için 401 verir (receipt-prefs.openReceiptPdf deseni):
 * popup slotu kullanıcı jesti içinde senkron alınır, blob hazır olunca
 * yönlendirilir.
 */
function openStaffDocument(id: string, onError: () => void): void {
  const tab = window.open('', '_blank');
  void api.get(`/staff-documents/${id}/file`, { responseType: 'blob' }).then(
    (res) => {
      const blobUrl = URL.createObjectURL(res.data as Blob);
      if (tab) tab.location.href = blobUrl;
      else onError();
    },
    () => {
      tab?.close();
      onError();
    },
  );
}

export function StaffDocumentsSection({ userId }: { userId: string }) {
  const { t } = useTranslation('common');
  const { locale } = useLocale();
  const { confirm } = useConfirm();
  const utils = trpc.useUtils();
  // airmed-design: rol yapamıyorsa buton GİZLİ — upload/sil yalnız manage yetkisinde.
  const canManage = usePermission('action:staffDocument.manage');

  const listQuery = trpc.staffDocument.list.useQuery({ userId });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const items = listQuery.data ?? [];

  const handleDelete = async (docId: string, fileName: string) => {
    const ok = await confirm({
      message: t('usersPage.detail.documents.deleteConfirm', { name: fileName }),
      destructive: true,
    });
    if (!ok) return;
    setDeletingId(docId);
    try {
      await api.delete(`/staff-documents/${docId}`);
      toast.success(t('usersPage.detail.documents.deleted'));
      await utils.staffDocument.list.invalidate({ userId });
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(e2.response?.data?.message ?? e2.message ?? t('errors.unexpected'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div>
          <h3 className="text-sm font-medium">{t('usersPage.detail.documents.title')}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('usersPage.detail.documents.hint')}
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <FileUp className="mr-2 h-4 w-4" aria-hidden />
            {t('usersPage.detail.documents.upload')}
          </Button>
        )}
      </div>

      {listQuery.isLoading ? (
        <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('states.loading')}
        </div>
      ) : items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {t('usersPage.detail.documents.empty')}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('usersPage.detail.documents.columns.type')}</TableHead>
              <TableHead>{t('usersPage.detail.documents.columns.file')}</TableHead>
              <TableHead>{t('usersPage.detail.documents.columns.size')}</TableHead>
              <TableHead>{t('usersPage.detail.documents.columns.date')}</TableHead>
              <TableHead>{t('usersPage.detail.documents.columns.uploadedBy')}</TableHead>
              <TableHead className="w-24 text-right">
                <span className="sr-only">{t('usersPage.detail.documents.columns.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell>{t(`usersPage.detail.documents.types.${doc.docType}`)}</TableCell>
                <TableCell className="max-w-[240px]">
                  <span className="block truncate font-medium" title={doc.fileName}>
                    {doc.fileName}
                  </span>
                  {doc.note && (
                    <span className="block truncate text-xs text-muted-foreground" title={doc.note}>
                      {doc.note}
                    </span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {formatBytes(doc.sizeBytes)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateTime(doc.createdAt, locale)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {doc.uploadedBy?.name ?? '—'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('usersPage.detail.documents.download')}
                      onClick={() =>
                        openStaffDocument(doc.id, () =>
                          toast.error(t('usersPage.detail.documents.downloadError')),
                        )
                      }
                    >
                      <Download className="h-4 w-4" aria-hidden />
                    </Button>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('usersPage.detail.documents.delete')}
                        disabled={deletingId === doc.id}
                        onClick={() => void handleDelete(doc.id, doc.fileName)}
                      >
                        {deletingId === doc.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden />
                        )}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <UploadDocumentDialog
        open={uploadOpen}
        userId={userId}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          setUploadOpen(false);
          void utils.staffDocument.list.invalidate({ userId });
        }}
      />
    </section>
  );
}

function UploadDocumentDialog({
  open,
  userId,
  onClose,
  onUploaded,
}: {
  open: boolean;
  userId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const { t } = useTranslation('common');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [docType, setDocType] = useState<DocType>('cv');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setDocType('cv');
    setFile(null);
    setNote('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setFile(null);
      return;
    }
    if (!ALLOWED_MIMES.includes(f.type.toLowerCase())) {
      toast.error(t('usersPage.detail.documents.uploadDialog.mimeError'));
      e.target.value = '';
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error(t('usersPage.detail.documents.uploadDialog.sizeError'));
      e.target.value = '';
      return;
    }
    setFile(f);
  };

  const submit = async () => {
    if (!file) {
      toast.error(t('usersPage.detail.documents.uploadDialog.fileRequired'));
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('userId', userId);
      fd.append('docType', docType);
      if (note.trim()) fd.append('note', note.trim());
      await api.post('/staff-documents', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(t('usersPage.detail.documents.uploaded'));
      reset();
      onUploaded();
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(e2.response?.data?.message ?? e2.message ?? t('errors.unexpected'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="w-full max-w-md p-6">
        <div className="space-y-1.5 mb-4">
          <DialogTitle>{t('usersPage.detail.documents.uploadDialog.title')}</DialogTitle>
          <DialogDescription>{t('usersPage.detail.documents.hint')}</DialogDescription>
        </div>
        <div className="space-y-4">
          <FormField label={t('usersPage.detail.documents.uploadDialog.type')} required>
            <select
              className={SELECT_CLASS}
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocType)}
            >
              {DOC_TYPES.map((dt) => (
                <option key={dt} value={dt}>
                  {t(`usersPage.detail.documents.types.${dt}`)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('usersPage.detail.documents.uploadDialog.file')} required>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_MIMES.join(',')}
              onChange={handleFileChange}
              className={cn(
                SELECT_CLASS,
                'h-auto py-2 file:mr-3 file:border-0 file:bg-transparent',
              )}
            />
          </FormField>
          {file && (
            <p className="text-xs text-muted-foreground">
              {file.name} · {formatBytes(file.size)}
            </p>
          )}
          <FormField label={t('usersPage.detail.documents.uploadDialog.note')}>
            <input
              type="text"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={SELECT_CLASS}
            />
          </FormField>
        </div>
        <div className="mt-4 flex flex-row justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('usersPage.detail.documents.uploadDialog.cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || !file}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {t('usersPage.detail.documents.uploadDialog.submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
