import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bot } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '../lib/trpc';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Switch } from '../components/ui/switch';
import { Tag } from '../components/ui/tag';

/**
 * Otomasyonlar hub'ı (#1031) — her otomasyon bir kart; kart üstünde aktif/pasif
 * switch, karta tıklayınca detay/ayar ekranı. İleride yeni otomasyonlar
 * (hatırlatma aramaları, recall vb.) bu grid'e kart olarak eklenir.
 * Geri butonu YOK: AppShell global BackBar render eder (#1031 çift-buton fix).
 */
export function AutomationsPage() {
  const { t } = useTranslation('common');

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('adminAutomations.title')}
        description={t('adminAutomations.description')}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AssistantCard />
      </div>
    </div>
  );
}

function AssistantCard() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const config = trpc.automation.getConfig.useQuery();

  const toggle = trpc.automation.updateConfig.useMutation({
    onSuccess: () => {
      utils.automation.getConfig.invalidate();
      toast.success(t('adminAutomations.config.saved'));
    },
    onError: () => toast.error(t('adminAutomations.config.saveError')),
  });

  if (config.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (config.error || !config.data) {
    return (
      <div className="rounded-xl border bg-background p-5">
        <p className="text-sm text-destructive">{t('adminAutomations.loadFailed')}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => config.refetch()}>
          {t('actions.retry')}
        </Button>
      </div>
    );
  }
  const enabled = config.data.enabled;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate('/admin/otomasyonlar/hasta-asistani')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate('/admin/otomasyonlar/hasta-asistani');
        }
      }}
      className="group flex cursor-pointer flex-col rounded-xl border bg-background p-5 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="automation-card-assistant"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
          <Bot className="h-5 w-5" aria-hidden />
        </span>
        {/* Switch kart navigasyonunu tetiklemesin */}
        <div
          className="flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <span
            className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
              enabled
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            {enabled
              ? t('adminAutomations.enabledState.on')
              : t('adminAutomations.enabledState.off')}
          </span>
          <Switch
            checked={enabled}
            disabled={toggle.isPending}
            onCheckedChange={(v) => toggle.mutate({ enabled: v === true })}
            aria-label={t('adminAutomations.config.enabled')}
            data-testid="automation-card-toggle"
          />
        </div>
      </div>
      <div className="mt-3 font-medium">{t('adminAutomations.assistant.cardTitle')}</div>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('adminAutomations.assistant.cardDescription')}
      </p>
      <div className="mt-3 flex items-center justify-between">
        <Tag>{config.data.model}</Tag>
        <ArrowRight
          className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>
    </div>
  );
}
