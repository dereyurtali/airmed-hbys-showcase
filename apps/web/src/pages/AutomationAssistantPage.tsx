import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Bot,
  CalendarCheck,
  ChevronDown,
  ExternalLink,
  MessageSquare,
  UserRound,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '../lib/trpc';
import { formatDateTime } from '../lib/i18n-format';
import { PageHeader } from '../components/layout/PageHeader';
import { OverviewStatCard } from '../components/overview/OverviewStatCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Chip } from '../components/ui/chip';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
import { EmptyState } from '../components/ui/empty-state';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Spinner } from '../components/ui/spinner';

/**
 * AI hasta asistanı detay ekranı — KPI + config + konuşma denetimi (EPIC #1018).
 * Hub'daki karttan açılır (#1031); geri butonu AppShell'in global BackBar'ı.
 */
export function AutomationAssistantPage() {
  const { t, i18n } = useTranslation('common');

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('adminAutomations.assistant.cardTitle')}
        description={t('adminAutomations.assistant.cardDescription')}
      />
      <StatsRow />
      <ConversationsSection locale={i18n.language} />
      <ActionsSection locale={i18n.language} />
      <ConfigSection />
      <SecretsSection />
    </div>
  );
}

function StatsRow() {
  const { t } = useTranslation('common');
  const stats = trpc.automation.stats.useQuery(undefined, { refetchInterval: 60_000 });

  if (stats.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }
  if (stats.error || !stats.data) return null;
  const d = stats.data;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <OverviewStatCard
        compact
        icon={MessageSquare}
        tint="sky"
        value={<span className="tabular-nums">{d.todayPatientMessages}</span>}
        label={t('adminAutomations.kpi.todayMessages')}
      />
      <OverviewStatCard
        compact
        icon={Bot}
        tint="blue"
        value={<span className="tabular-nums">{d.conversations.bot_active}</span>}
        label={t('adminAutomations.kpi.activeConversations')}
      />
      <OverviewStatCard
        compact
        icon={Users}
        tint="amber"
        value={<span className="tabular-nums">{d.conversations.human_active}</span>}
        label={t('adminAutomations.kpi.handedOff')}
      />
      <OverviewStatCard
        compact
        icon={CalendarCheck}
        tint="emerald"
        value={<span className="tabular-nums">{d.actions.appointment_created}</span>}
        label={t('adminAutomations.kpi.appointments')}
      />
    </div>
  );
}

interface ConfigForm {
  enabled: boolean;
  provider: 'anthropic' | 'openrouter';
  model: string;
  systemPrompt: string;
  knowledgeBase: string;
  chatwootAccountId: string;
  chatwootBaseUrl: string;
  webhookPublicBaseUrl: string;
}

interface SecretStatus {
  set: boolean;
  last4: string | null;
}

interface ServerConfig {
  enabled: boolean;
  provider: string;
  model: string;
  systemPrompt: string;
  knowledgeBase: string | null;
  channelSettings: {
    chatwootAccountId?: number;
    chatwootBaseUrl?: string;
    webhookPublicBaseUrl?: string;
  } | null;
  secrets: {
    webhook: { set: boolean };
    chatwootBotToken: SecretStatus;
    anthropicKey: SecretStatus;
    openrouterKey: SecretStatus;
  };
  revision: number;
}

// Sunucu config'i → form değerleri (init + kayıt-sonrası senkron aynı yolu kullanır).
function toForm(c: ServerConfig): ConfigForm {
  const settings = c.channelSettings ?? {};
  return {
    enabled: c.enabled,
    provider: c.provider === 'openrouter' ? 'openrouter' : 'anthropic',
    model: c.model,
    systemPrompt: c.systemPrompt,
    knowledgeBase: c.knowledgeBase ?? '',
    chatwootAccountId: settings.chatwootAccountId ? String(settings.chatwootAccountId) : '',
    chatwootBaseUrl: settings.chatwootBaseUrl ?? '',
    webhookPublicBaseUrl: settings.webhookPublicBaseUrl ?? '',
  };
}

function ConfigSection() {
  const { t } = useTranslation('common');
  const utils = trpc.useUtils();
  const config = trpc.automation.getConfig.useQuery();
  const data = config.data ?? null;
  const [form, setForm] = useState<ConfigForm | null>(null);
  const [openSection, setOpenSection] = useState(false);
  // Son SUNUCU hâli — dirty karşılaştırması bunun üzerinden (#1031 veri kaybı koruması).
  const [savedSnapshot, setSavedSnapshot] = useState<ConfigForm | null>(null);
  const defaultPrompt = trpc.automation.getDefaultPrompt.useQuery(undefined, { enabled: false });

  useEffect(() => {
    if (!data || form) return;
    const initial = toForm(data);
    setForm(initial);
    setSavedSnapshot(initial);
  }, [data, form]);

  const dirty = form && savedSnapshot && JSON.stringify(form) !== JSON.stringify(savedSnapshot);

  // Kaydedilmemiş değişiklikle sekme kapatma/yenileme uyarısı.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const update = trpc.automation.updateConfig.useMutation({
    onSuccess: (updated) => {
      // Formu sunucunun döndürdüğü gerçek hâle senkronla — dirty sıfırlanır,
      // revizyon rozeti güncellenir, kullanıcı girdisi kaybolmaz.
      const next = toForm(updated);
      setForm(next);
      setSavedSnapshot(next);
      toast.success(t('adminAutomations.config.saved'));
      utils.automation.getConfig.invalidate();
      // #1034 — base URL webhook URL'ini etkiler; sırlar bölümü de tazelensin.
      utils.automation.getWebhookInfo.invalidate();
    },
    onError: () => toast.error(t('adminAutomations.config.saveError')),
  });

  const resetPromptToDefault = async () => {
    const r = await defaultPrompt.refetch();
    if (r.data?.systemPrompt) {
      setForm((f) => (f ? { ...f, systemPrompt: r.data.systemPrompt } : f));
    }
  };

  if (config.isLoading || !form) return <Skeleton className="h-96 rounded-xl" />;
  if (config.error) {
    return (
      <section className="rounded-xl border bg-background p-5">
        <p className="text-sm text-destructive">{t('adminAutomations.loadFailed')}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => config.refetch()}>
          {t('actions.retry')}
        </Button>
      </section>
    );
  }

  const set = <K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = () => {
    const accountId = Number.parseInt(form.chatwootAccountId, 10);
    update.mutate({
      enabled: form.enabled,
      provider: form.provider,
      model: form.model,
      systemPrompt: form.systemPrompt,
      knowledgeBase: form.knowledgeBase.trim() === '' ? null : form.knowledgeBase,
      channelSettings: Number.isFinite(accountId)
        ? {
            chatwootAccountId: accountId,
            ...(form.chatwootBaseUrl.trim()
              ? { chatwootBaseUrl: form.chatwootBaseUrl.trim() }
              : {}),
            ...(form.webhookPublicBaseUrl.trim()
              ? { webhookPublicBaseUrl: form.webhookPublicBaseUrl.trim() }
              : {}),
          }
        : null,
    });
  };

  return (
    <section className="rounded-xl border bg-background">
      {/* #1036 — açılır/kapanır bölüm (Ali: derli toplu dursun). Aktif/pasif
          switch'i kaldırıldı — hub kartındaki toggle tek doğru yer. */}
      <button
        type="button"
        onClick={() => setOpenSection((o) => !o)}
        aria-expanded={openSection}
        className="flex w-full flex-wrap items-center justify-between gap-3 p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6"
      >
        <div>
          <h2 className="font-semibold">{t('adminAutomations.config.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('adminAutomations.config.description')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="tabular-nums">
            {t('adminAutomations.config.revision', { rev: data?.revision ?? 1 })}
          </Badge>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${openSection ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </div>
      </button>
      {openSection && (
        <div className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="agent-provider">{t('adminAutomations.config.provider')}</Label>
              <Select
                value={form.provider}
                onValueChange={(v) => set('provider', v as ConfigForm['provider'])}
              >
                <SelectTrigger id="agent-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-model">{t('adminAutomations.config.model')}</Label>
              <Input
                id="agent-model"
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-cw-account">
                {t('adminAutomations.config.chatwootAccountId')}
              </Label>
              <Input
                id="agent-cw-account"
                inputMode="numeric"
                value={form.chatwootAccountId}
                onChange={(e) => set('chatwootAccountId', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-cw-url">{t('adminAutomations.config.chatwootBaseUrl')}</Label>
              <Input
                id="agent-cw-url"
                placeholder="https://app.chatwoot.com"
                value={form.chatwootBaseUrl}
                onChange={(e) => set('chatwootBaseUrl', e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="agent-webhook-base">
                {t('adminAutomations.secrets.webhookBaseUrlLabel')}
              </Label>
              <Input
                id="agent-webhook-base"
                placeholder="https://staging.example.com:10000"
                value={form.webhookPublicBaseUrl}
                onChange={(e) => set('webhookPublicBaseUrl', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('adminAutomations.secrets.webhookBaseUrlHint')}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="agent-prompt">{t('adminAutomations.config.systemPrompt')}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetPromptToDefault}
                disabled={defaultPrompt.isFetching}
              >
                {t('adminAutomations.config.resetPrompt')}
              </Button>
            </div>
            <textarea
              id="agent-prompt"
              className="min-h-[280px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={form.systemPrompt}
              onChange={(e) => set('systemPrompt', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-kb">{t('adminAutomations.config.knowledgeBase')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('adminAutomations.config.knowledgeBaseHint')}
            </p>
            <textarea
              id="agent-kb"
              className="min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={form.knowledgeBase}
              onChange={(e) => set('knowledgeBase', e.target.value)}
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            {dirty && (
              <span className="text-xs text-amber-700" role="status">
                {t('adminAutomations.config.unsavedChanges')}
              </span>
            )}
            <Button
              onClick={save}
              disabled={update.isPending || !dirty}
              data-testid="automation-config-save"
            >
              {update.isPending && <Spinner className="mr-2 h-4 w-4" />}
              {t('actions.save')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// #1034 — Sırlar: write-only girişler + webhook URL kopyalama. Kayıtlı değer
// asla geri gösterilmez (yalnız son 4); kaydet sonrası inputlar temizlenir.
function SecretsSection() {
  const { t } = useTranslation('common');
  const utils = trpc.useUtils();
  const config = trpc.automation.getConfig.useQuery();
  const webhook = trpc.automation.getWebhookInfo.useQuery();
  const [keys, setKeys] = useState({ chatwootBotToken: '', anthropicKey: '', openrouterKey: '' });
  const [copied, setCopied] = useState(false);
  const [openSection, setOpenSection] = useState(false);

  const invalidate = () => {
    utils.automation.getConfig.invalidate();
    utils.automation.getWebhookInfo.invalidate();
  };
  const updateSecrets = trpc.automation.updateSecrets.useMutation({
    onSuccess: () => {
      toast.success(t('adminAutomations.secrets.keysSaved'));
      setKeys({ chatwootBotToken: '', anthropicKey: '', openrouterKey: '' });
      invalidate();
    },
    onError: () => toast.error(t('adminAutomations.config.saveError')),
  });
  const rotate = trpc.automation.rotateWebhookSecret.useMutation({
    onSuccess: () => {
      toast.success(t('adminAutomations.secrets.rotated'));
      invalidate();
    },
    onError: () => toast.error(t('adminAutomations.config.saveError')),
  });

  const secrets = (config.data as ServerConfig | undefined)?.secrets;
  const dirtyKeys = Object.values(keys).some((v) => v.trim() !== '');

  const copyUrl = async () => {
    if (!webhook.data?.url) return;
    await navigator.clipboard.writeText(webhook.data.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const saveKeys = () => {
    updateSecrets.mutate({
      ...(keys.chatwootBotToken.trim() ? { chatwootBotToken: keys.chatwootBotToken.trim() } : {}),
      ...(keys.anthropicKey.trim() ? { anthropicKey: keys.anthropicKey.trim() } : {}),
      ...(keys.openrouterKey.trim() ? { openrouterKey: keys.openrouterKey.trim() } : {}),
    });
  };

  const statusBadge = (s: SecretStatus | undefined) =>
    s?.set ? (
      <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        {t('adminAutomations.secrets.savedBadge', { last4: s.last4 ?? '' })}
      </span>
    ) : (
      <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
        {t('adminAutomations.secrets.notSet')}
      </span>
    );

  return (
    <section className="rounded-xl border bg-background">
      <button
        type="button"
        onClick={() => setOpenSection((o) => !o)}
        aria-expanded={openSection}
        className="flex w-full flex-wrap items-center justify-between gap-3 p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6"
      >
        <div>
          <h2 className="font-semibold">{t('adminAutomations.secrets.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('adminAutomations.secrets.description')}
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${openSection ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {openSection && (
        <div className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
          <div className="space-y-1.5">
            <Label>{t('adminAutomations.secrets.webhookUrlLabel')}</Label>
            {webhook.isLoading && <Skeleton className="h-9 rounded-md" />}
            {webhook.data && webhook.data.url && (
              <div className="flex flex-wrap items-center gap-2">
                <Input readOnly value={webhook.data.url} className="flex-1 font-mono text-xs" />
                <Button type="button" variant="outline" size="sm" onClick={copyUrl}>
                  {copied
                    ? t('adminAutomations.secrets.copied')
                    : t('adminAutomations.secrets.copy')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={rotate.isPending}
                  onClick={() => rotate.mutate()}
                >
                  {t('adminAutomations.secrets.rotate')}
                </Button>
              </div>
            )}
            {webhook.data && !webhook.data.url && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-amber-700">
                  {webhook.data.configured
                    ? t('adminAutomations.secrets.needBaseUrl')
                    : t('adminAutomations.secrets.notConfigured')}
                </p>
                {!webhook.data.configured && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={rotate.isPending}
                    onClick={() => rotate.mutate()}
                  >
                    {t('adminAutomations.secrets.generate')}
                  </Button>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t('adminAutomations.secrets.rotateHint')}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ['chatwootBotToken', 'chatwootBotToken'],
                ['anthropicKey', 'anthropicKey'],
                ['openrouterKey', 'openrouterKey'],
              ] as const
            ).map(([key]) => (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`secret-${key}`}>{t(`adminAutomations.secrets.${key}`)}</Label>
                  {statusBadge(secrets?.[key])}
                </div>
                <Input
                  id={`secret-${key}`}
                  type="password"
                  autoComplete="off"
                  placeholder={
                    secrets?.[key]?.set
                      ? t('adminAutomations.secrets.replacePlaceholder')
                      : t('adminAutomations.secrets.enterPlaceholder')
                  }
                  value={keys[key]}
                  onChange={(e) => setKeys((k) => ({ ...k, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={saveKeys}
              disabled={updateSecrets.isPending || !dirtyKeys}
              data-testid="automation-secrets-save"
            >
              {updateSecrets.isPending && <Spinner className="mr-2 h-4 w-4" />}
              {t('adminAutomations.secrets.saveKeys')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

const STATUS_BADGE: Record<string, string> = {
  bot_active: 'bg-sky-50 text-sky-700 border-sky-200',
  human_active: 'bg-amber-50 text-amber-700 border-amber-200',
  closed: 'bg-slate-50 text-slate-600 border-slate-200',
};

const STATUS_FILTERS = ['all', 'bot_active', 'human_active', 'closed'] as const;

function ConversationsSection({ locale }: { locale: string }) {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('all');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = trpc.automation.listConversations.useQuery(
    { status: status === 'all' ? undefined : status, page, pageSize: 20 },
    { refetchInterval: 30_000 },
  );

  // #1038 — personeldeki konuşmayı ekrandan bota geri ver (Chatwoot gerekmez).
  const utils = trpc.useUtils();
  const returnToBot = trpc.automation.returnToBot.useMutation({
    onSuccess: () => {
      toast.success(t('adminAutomations.conversations.returnedToBot'));
      utils.automation.listConversations.invalidate();
      utils.automation.stats.invalidate();
      utils.automation.listActions.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <section className="space-y-4 rounded-xl border bg-background p-5 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{t('adminAutomations.conversations.title')}</h2>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((key) => (
            <Chip
              key={key}
              active={status === key}
              onClick={() => {
                setStatus(key);
                setPage(1);
              }}
            >
              {key === 'all'
                ? t('adminAutomations.conversations.filterAll')
                : t(`adminAutomations.status.${key}`)}
            </Chip>
          ))}
        </div>
      </header>

      {list.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      )}
      {list.error && <p className="text-sm text-destructive">{t('adminAutomations.loadFailed')}</p>}
      {list.data && list.data.items.length === 0 && (
        <EmptyState title={t('adminAutomations.conversations.empty')} />
      )}
      {list.data && list.data.items.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {list.data.items.map((c) => (
            <li key={c.id} className="flex items-center gap-2 pr-3">
              <button
                type="button"
                onClick={() => setOpenId(c.id)}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="automation-conversation-row"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UserRound className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {c.contactName || c.contactPhone || t('adminAutomations.conversations.unknown')}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t(`adminAutomations.channel.${c.channel}`)} ·{' '}
                    {t('adminAutomations.conversations.messageCount', {
                      count: c._count.messages,
                    })}
                    {c.patient
                      ? ` · ${c.patient.firstName} ${c.patient.lastName} (${c.patient.mrn})`
                      : ''}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[c.status] ?? ''}`}
                >
                  {t(`adminAutomations.status.${c.status}`)}
                </span>
                <span className="w-32 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {formatDateTime(c.lastMessageAt, locale)}
                </span>
              </button>
              {c.status === 'human_active' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={returnToBot.isPending}
                  onClick={() => returnToBot.mutate({ id: c.id })}
                  data-testid="automation-return-to-bot"
                >
                  <Bot className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {t('adminAutomations.conversations.returnToBot')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Pager page={page} pageSize={20} total={list.data?.total ?? 0} onPage={setPage} />

      {openId && (
        <TranscriptDialog conversationId={openId} onClose={() => setOpenId(null)} locale={locale} />
      )}
    </section>
  );
}

function TranscriptDialog({
  conversationId,
  onClose,
  locale,
}: {
  conversationId: string;
  onClose: () => void;
  locale: string;
}) {
  const { t } = useTranslation('common');
  const detail = trpc.automation.getConversation.useQuery({ id: conversationId });
  const config = trpc.automation.getConfig.useQuery();

  const chatwootUrl = useMemo(() => {
    const settings = config.data?.channelSettings ?? {};
    if (!settings.chatwootAccountId || !detail.data) return null;
    const base = (settings.chatwootBaseUrl ?? 'https://app.chatwoot.com').replace(/\/$/, '');
    return `${base}/app/accounts/${settings.chatwootAccountId}/conversations/${detail.data.chatwootConversationId}`;
  }, [config.data, detail.data]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <div className="mb-2">
          <DialogTitle className="flex items-center justify-between gap-2 pr-6">
            <span>
              {detail.data?.contactName ||
                detail.data?.contactPhone ||
                t('adminAutomations.conversations.transcriptTitle')}
            </span>
            {chatwootUrl && (
              <a
                href={chatwootUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-normal text-primary hover:underline"
              >
                {t('adminAutomations.conversations.openChatwoot')}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </DialogTitle>
        </div>
        {detail.isLoading && <Skeleton className="h-48 rounded-lg" />}
        {detail.error && (
          <p className="text-sm text-destructive">{t('adminAutomations.loadFailed')}</p>
        )}
        {detail.data && (
          <div className="space-y-3">
            {detail.data.patient && (
              <p className="text-sm text-muted-foreground">
                {t('adminAutomations.conversations.linkedPatient')}:{' '}
                <Link
                  to={`/patients/${detail.data.patient.id}`}
                  className="text-primary hover:underline"
                >
                  {detail.data.patient.firstName} {detail.data.patient.lastName} (
                  {detail.data.patient.mrn})
                </Link>
              </p>
            )}
            <ul className="space-y-2">
              {detail.data.messages.map((m) => (
                <li
                  key={m.id}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    m.role === 'assistant'
                      ? 'border-primary/20 bg-primary/5'
                      : m.role === 'staff'
                        ? 'border-amber-200 bg-amber-50'
                        : 'bg-background'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-medium">{t(`adminAutomations.role.${m.role}`)}</span>
                    <span className="tabular-nums">{formatDateTime(m.createdAt, locale)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  {m.error && <p className="mt-1 text-xs text-destructive">{m.error}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const ACTION_TYPES = [
  'appointment_created',
  'appointment_cancelled',
  'patient_created',
  'patient_matched',
  'handoff',
  'returned_to_bot',
  'error',
] as const;

const ACTION_BADGE: Record<string, string> = {
  appointment_created: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  appointment_cancelled: 'bg-slate-50 text-slate-600 border-slate-200',
  patient_created: 'bg-blue-50 text-blue-700 border-blue-200',
  patient_matched: 'bg-sky-50 text-sky-700 border-sky-200',
  handoff: 'bg-amber-50 text-amber-700 border-amber-200',
  returned_to_bot: 'bg-violet-50 text-violet-700 border-violet-200',
  error: 'bg-red-50 text-red-700 border-red-200',
};

function ActionsSection({ locale }: { locale: string }) {
  const { t } = useTranslation('common');
  const [type, setType] = useState<string>('all');
  const [page, setPage] = useState(1);
  const list = trpc.automation.listActions.useQuery(
    {
      type: type === 'all' ? undefined : (type as (typeof ACTION_TYPES)[number]),
      page,
      pageSize: 20,
    },
    { refetchInterval: 60_000 },
  );

  return (
    <section className="space-y-4 rounded-xl border bg-background p-5 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t('adminAutomations.actions.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('adminAutomations.actions.description')}
          </p>
        </div>
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-56" aria-label={t('adminAutomations.actions.filterLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('adminAutomations.actions.filterAll')}</SelectItem>
            {ACTION_TYPES.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`adminAutomations.actionType.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {list.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      )}
      {list.error && <p className="text-sm text-destructive">{t('adminAutomations.loadFailed')}</p>}
      {list.data && list.data.items.length === 0 && (
        <EmptyState title={t('adminAutomations.actions.empty')} />
      )}
      {list.data && list.data.items.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {list.data.items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
              <span
                className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${ACTION_BADGE[a.type] ?? ''}`}
              >
                {t(`adminAutomations.actionType.${a.type}`)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{a.summary}</span>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                {a.conversation?.contactName || a.conversation?.contactPhone || ''}
              </span>
              <span className="w-32 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {formatDateTime(a.createdAt, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Pager page={page} pageSize={20} total={list.data?.total ?? 0} onPage={setPage} />
    </section>
  );
}

function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const { t } = useTranslation('common');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      <span className="tabular-nums text-muted-foreground">
        {page} / {totalPages}
      </span>
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('actions.previous')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        {t('actions.next')}
      </Button>
    </div>
  );
}
