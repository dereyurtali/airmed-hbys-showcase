import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bug, HelpCircle, ImagePlus, Lightbulb, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';
import { useAuth } from '../../providers/AuthProvider';
import { APP_VERSION } from '../../lib/version';
import { cn } from '../../lib/utils';
import { api } from '../../lib/api';
import { AnnotationStudio } from './AnnotationStudio';

// I2.4 (#822) — Geri-Bildirim Merkezi: sağ drawer, 2 sekme (Yeni İstek / İsteklerim).
// Bağlam (ekran/sürüm/rol/mod/locale/viewport) otomatik yakalanır; kullanıcı sadece
// tür+başlık+açıklama girer. Erişim TopBar'da usePermission('page:feedbackCenter').

type Kind = 'bug' | 'improvement' | 'question';

const KIND_META: { key: Kind; icon: typeof Bug }[] = [
  { key: 'improvement', icon: Lightbulb },
  { key: 'bug', icon: Bug },
  { key: 'question', icon: HelpCircle },
];

const STATUS_TONE: Record<string, string> = {
  submitted: 'bg-amber-50 text-amber-700',
  in_progress: 'bg-blue-50 text-blue-700',
  shipped: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-muted text-muted-foreground',
};

type TFn = ReturnType<typeof useTranslation>['t'];

export function FeedbackCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation('feedback');
  const location = useLocation();
  const { user } = useAuth();
  const [tab, setTab] = useState<'new' | 'mine'>('new');
  // Anotasyon stüdyosu + taslak form state'i burada yaşar (NewRequestForm'da
  // değil): stüdyo açılınca aşağıdaki drawer GİZLENİR, böylece tam-ekran
  // `fixed` overlay Radix drawer'ının transform/overflow/focus-trap'ine
  // hapsolmaz (#824 bug — drawer içinde ekranda işaretleme yapılamıyordu).
  // Drawer unmount olsa da taslak (tür/başlık/açıklama/görsel) burada korunur.
  const [studioOpen, setStudioOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('improvement');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [annotation, setAnnotation] = useState<Blob | null>(null);

  const context = useMemo(
    () => ({
      role: user?.roles?.[0] ?? null,
      mode: user?.mode ?? null,
      locale: i18n.language,
      viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null,
    }),
    [user, i18n.language],
  );

  return (
    <>
      {/* Stüdyo açıkken drawer görsel olarak kapanır; ama onClose TETİKLENMEZ
          (TopBar feedback state'i açık kalır → stüdyodan dönünce drawer geri gelir). */}
      <Dialog
        open={open && !studioOpen}
        onOpenChange={(o) => {
          if (!o && !studioOpen) onClose();
        }}
      >
        <DialogContent
          variant="drawer-right"
          data-feedback-drawer
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <DialogTitle className="flex items-center gap-2 border-b px-5 py-4 text-base">
            <Lightbulb className="h-5 w-5 text-primary" aria-hidden />
            {t('title', { defaultValue: 'Geri-Bildirim Merkezi' })}
          </DialogTitle>

          <div className="flex gap-1 border-b p-2">
            {(['new', 'mine'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-pressed={tab === key}
                className={cn(
                  'focus-ring min-h-[40px] flex-1 rounded-lg px-3 text-sm font-medium transition-colors',
                  tab === key
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {t(`tab.${key}`, { defaultValue: key === 'new' ? 'Yeni İstek' : 'İsteklerim' })}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {tab === 'new' ? (
              <NewRequestForm
                routePath={location.pathname}
                context={context}
                t={t}
                onDone={() => setTab('mine')}
                kind={kind}
                setKind={setKind}
                title={title}
                setTitle={setTitle}
                description={description}
                setDescription={setDescription}
                annotation={annotation}
                setAnnotation={setAnnotation}
                onOpenStudio={() => setStudioOpen(true)}
              />
            ) : (
              <MyRequestsList t={t} />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Stüdyo = üst-seviye tam-ekran overlay (drawer DIŞINDA → transform/clip
          yok, pointer çizimi çalışır). */}
      {studioOpen && (
        <AnnotationStudio
          onConfirm={(blob) => {
            setAnnotation(blob);
            setStudioOpen(false);
          }}
          onCancel={() => setStudioOpen(false)}
        />
      )}
    </>
  );
}

function NewRequestForm({
  routePath,
  context,
  onDone,
  t,
  kind,
  setKind,
  title,
  setTitle,
  description,
  setDescription,
  annotation,
  setAnnotation,
  onOpenStudio,
}: {
  routePath: string;
  context: Record<string, unknown>;
  onDone: () => void;
  t: TFn;
  kind: Kind;
  setKind: (k: Kind) => void;
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  annotation: Blob | null;
  setAnnotation: (b: Blob | null) => void;
  onOpenStudio: () => void;
}) {
  const utils = trpc.useUtils();

  const create = trpc.feedback.create.useMutation({
    onSuccess: async (request: { id: string }) => {
      // Anotasyon eklendiyse, kayıt oluşunca redakte PNG'yi attachment'a yükle.
      if (annotation) {
        try {
          const form = new FormData();
          form.append('file', annotation, 'annotation.png');
          form.append('kind', 'annotation');
          await api.post(`/feedback/${request.id}/attachments`, form);
        } catch {
          toast.error(t('studio.uploadFailed', { defaultValue: 'Görsel yüklenemedi' }));
        }
      }
      toast.success(t('submitted', { defaultValue: 'İsteğin alındı, teşekkürler!' }));
      setTitle('');
      setDescription('');
      setAnnotation(null);
      void utils.feedback.list.invalidate();
      onDone();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  const valid = title.trim().length >= 3 && description.trim().length >= 1;
  const submit = () => {
    if (!valid) return;
    create.mutate({
      kind,
      title: title.trim(),
      description: description.trim(),
      routePath,
      appVersion: APP_VERSION,
      contextJson: context,
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium">
          {t('form.kind', { defaultValue: 'Tür' })}
        </label>
        <div className="grid grid-cols-3 gap-2">
          {KIND_META.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setKind(key)}
              aria-pressed={kind === key}
              className={cn(
                'focus-ring flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg border text-xs font-medium transition-colors',
                kind === key
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-input hover:bg-muted',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t(`kind.${key}`, {
                defaultValue:
                  key === 'bug' ? 'Hata' : key === 'improvement' ? 'Geliştirme' : 'Soru',
              })}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="fb-title" className="mb-1.5 block text-sm font-medium">
          {t('form.title', { defaultValue: 'Başlık' })}
        </label>
        <input
          id="fb-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder={t('form.titlePlaceholder', { defaultValue: 'Kısa özet' })}
          className="focus-ring h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
        />
      </div>

      <div>
        <label htmlFor="fb-desc" className="mb-1.5 block text-sm font-medium">
          {t('form.description', { defaultValue: 'Açıklama' })}
        </label>
        <textarea
          id="fb-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          maxLength={5000}
          placeholder={t('form.descriptionPlaceholder', {
            defaultValue:
              'Ne oldu / ne olmasını istersin? (Kişisel bilgi yazma — otomatik temizlenir)',
          })}
          className="focus-ring w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        {t('form.contextNote', {
          defaultValue: 'Ekran, sürüm ve cihaz bilgisi otomatik eklenir; hasta verisi gönderilmez.',
        })}
        <span className="ml-1 font-mono">{routePath}</span>
      </p>

      <button
        type="button"
        onClick={onOpenStudio}
        className="focus-ring flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-input text-sm font-medium text-muted-foreground hover:bg-muted"
      >
        <ImagePlus className="h-4 w-4" aria-hidden />
        {annotation
          ? t('studio.attached', { defaultValue: 'Görsel eklendi — değiştir' })
          : t('studio.markScreen', { defaultValue: 'Ekranı işaretle (opsiyonel)' })}
      </button>

      <Button onClick={submit} disabled={!valid || create.isPending} size="lg" className="w-full">
        {create.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Send className="mr-2 h-4 w-4" />
        )}
        {t('form.submit', { defaultValue: 'Gönder' })}
      </Button>
    </div>
  );
}

// trpc include(attachments) çıkarımı TS2589'a (deep instantiation) yol açıyor →
// ekranda kullanılan alanlara daraltılmış açık tip.
type FeedbackRow = { id: string; title: string; status: string; shippedVersion: string | null };

function MyRequestsList({ t }: { t: TFn }) {
  const q = trpc.feedback.list.useQuery({ mineOnly: true, limit: 50 });
  const rows = (q.data ?? []) as FeedbackRow[];

  if (q.isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-muted" />;
  }
  if (rows.length === 0) {
    return (
      <p className="px-3 py-10 text-center text-sm text-muted-foreground">
        {t('list.empty', { defaultValue: 'Henüz bir isteğin yok.' })}
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="rounded-xl border bg-background p-4">
          <div className="flex items-start justify-between gap-3">
            <span className="text-sm font-medium">{r.title}</span>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                STATUS_TONE[r.status] ?? 'bg-muted text-muted-foreground',
              )}
            >
              {t(`status.${r.status}`, { defaultValue: r.status })}
            </span>
          </div>
          {r.shippedVersion && (
            <p className="mt-1 text-xs text-emerald-600">
              {t('list.shippedIn', { defaultValue: 'Yayında' })}: v{r.shippedVersion}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
