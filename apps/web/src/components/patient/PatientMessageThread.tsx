import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MessageSquare, Plus, Send, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';
import { useLocale } from '../../providers/LocaleProvider';
import { formatDateTime } from '../../lib/i18n-format';

// S15-PR19 — Hasta-bağlı bağlamsal mesajlaşma paneli. Worklist hasta kartına
// veya PatientDetailPage'e gömülür. Klinik personeli arasında mesaj; hasta
// görmez.

interface Thread {
  id: string;
  subject: string | null;
  lastMessageAt: string;
  createdBy: { id: string; name: string };
  _count?: { messages: number };
}

interface ThreadMessage {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
}

export function PatientMessageThread({ patientId }: { patientId: string }) {
  const { t } = useTranslation(['messaging', 'common']);
  const { locale } = useLocale();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [composeBody, setComposeBody] = useState('');
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newBody, setNewBody] = useState('');

  const threadsApi = (
    trpc.messaging as unknown as {
      threads: {
        listForPatient: {
          useQuery: (
            input: { patientId: string },
            opts?: { refetchInterval?: number },
          ) => { data: Thread[] | undefined; isLoading: boolean; refetch: () => Promise<unknown> };
        };
        listMessages: {
          useQuery: (
            input: { threadId: string },
            opts?: { enabled?: boolean; refetchInterval?: number },
          ) => {
            data: ThreadMessage[] | undefined;
            isLoading: boolean;
            refetch: () => Promise<unknown>;
          };
        };
        create: {
          useMutation: (opts: {
            onSuccess: () => void;
            onError: (err: { message: string }) => void;
          }) => {
            mutate: (input: {
              patientId: string;
              subject: string | null;
              initialMessage: string;
            }) => void;
            isPending: boolean;
          };
        };
        sendMessage: {
          useMutation: (opts: {
            onSuccess: () => void;
            onError: (err: { message: string }) => void;
          }) => {
            mutate: (input: { threadId: string; body: string }) => void;
            isPending: boolean;
          };
        };
      };
    }
  ).threads;

  const threadsQuery = threadsApi.listForPatient.useQuery(
    { patientId },
    { refetchInterval: 60_000 },
  );
  const messagesQuery = threadsApi.listMessages.useQuery(
    { threadId: activeThreadId ?? '' },
    { enabled: !!activeThreadId, refetchInterval: 15_000 },
  );

  // #1066 — anahtarsız utils.invalidate() uygulamadaki TÜM aktif query'leri
  // invalidate ediyordu (hasta detayında tüm section'larda görünür refetch
  // flaş'ı + network patlaması). Yalnız mesaj query'leri tazelenir.
  const createMutation = threadsApi.create.useMutation({
    onSuccess: () => {
      toast.success(t('messaging:thread.createSuccess'));
      setNewThreadOpen(false);
      setNewSubject('');
      setNewBody('');
      void threadsQuery.refetch();
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });
  const sendMutation = threadsApi.sendMessage.useMutation({
    onSuccess: () => {
      setComposeBody('');
      void messagesQuery.refetch();
      void threadsQuery.refetch();
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });

  const threads = threadsQuery.data ?? [];
  const messages = messagesQuery.data ?? [];

  return (
    <section className="rounded-md border bg-card" data-testid="patient-thread-panel">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="h-4 w-4" />
          {t('messaging:thread.title')}
          {threads.length > 0 && (
            <span className="rounded-full bg-muted px-2 text-xs">{threads.length}</span>
          )}
        </h3>
        <Button size="sm" variant="ghost" onClick={() => setNewThreadOpen((o) => !o)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('messaging:thread.new')}
        </Button>
      </header>

      {newThreadOpen && (
        <div className="space-y-2 border-b p-3">
          <input
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            placeholder={t('messaging:thread.subjectPlaceholder') ?? ''}
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            maxLength={200}
          />
          <textarea
            className="min-h-[60px] w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            placeholder={t('messaging:thread.initialMessagePlaceholder') ?? ''}
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            maxLength={4000}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setNewThreadOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={newBody.trim().length === 0 || createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  patientId,
                  subject: newSubject.trim() || null,
                  initialMessage: newBody.trim(),
                })
              }
            >
              {createMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {t('messaging:thread.create')}
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr]">
        <ul className="max-h-64 overflow-auto border-r">
          {threads.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t('messaging:thread.empty')}
            </li>
          )}
          {threads.map((th) => (
            <li key={th.id}>
              <button
                type="button"
                onClick={() => setActiveThreadId(th.id)}
                className={
                  'w-full border-b px-3 py-2 text-left text-xs hover:bg-muted/50 ' +
                  (activeThreadId === th.id ? 'bg-sky-50' : '')
                }
                data-testid={`thread-${th.id}`}
              >
                <div className="truncate font-medium">
                  {th.subject ?? t('messaging:thread.noSubject')}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {th.createdBy.name} · {th._count?.messages ?? 0}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex min-h-[200px] flex-col">
          {!activeThreadId ? (
            <div className="flex flex-1 items-center justify-center px-4 py-6 text-xs text-muted-foreground">
              {t('messaging:thread.selectPrompt')}
            </div>
          ) : (
            <>
              <div className="max-h-64 flex-1 space-y-2 overflow-auto px-3 py-2">
                {messages.map((m) => (
                  <div key={m.id} className="rounded-md bg-muted/40 p-2 text-sm">
                    <div className="mb-0.5 flex justify-between text-[11px] text-muted-foreground">
                      <span>{m.author.name}</span>
                      <span>{formatDateTime(m.createdAt, locale)}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                ))}
              </div>
              <div className="border-t p-2">
                <div className="flex gap-2">
                  <textarea
                    className="min-h-[40px] flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
                    placeholder={t('messaging:thread.composePlaceholder') ?? ''}
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    maxLength={4000}
                    data-testid="thread-compose"
                  />
                  <Button
                    size="sm"
                    disabled={composeBody.trim().length === 0 || sendMutation.isPending}
                    onClick={() =>
                      sendMutation.mutate({
                        threadId: activeThreadId,
                        body: composeBody.trim(),
                      })
                    }
                    data-testid="thread-send"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
