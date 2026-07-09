import { useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { usePermission } from '../hooks/usePermission';
import {
  FRAUD_ALERT_STATUSES,
  FRAUD_RULE_KEYS,
  FRAUD_SEVERITIES,
  SEVERITY_BADGE,
  STATUS_BADGE,
  type FraudAlertStatus,
  type FraudRuleKey,
  type FraudSeverity,
} from '../lib/fraud.constants';
import { trpc } from '../lib/trpc';
import { useLocale } from '../providers/LocaleProvider';
import { localeToIntl } from '../lib/i18n-format';

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// AppRouter type 20+ router'la TS2589 sınırına yaklaştığından bu sayfa
// için trpc.fraud'u gevşek tipte alıyoruz (CommissionPage ile aynı pattern).
// v0.3'te sub-router refactor.
type LooseMutation = {
  useMutation: (opts: {
    onSuccess?: (data: unknown) => void;
    onError?: (err: unknown) => void;
  }) => { mutate: (input: unknown) => void; isPending: boolean };
};
const looseFraud = trpc.fraud as unknown as {
  updateAlertStatus: LooseMutation;
  toggleRule: LooseMutation;
  scanNow: LooseMutation;
};

interface AlertRow {
  id: string;
  ruleKey: FraudRuleKey;
  severity: FraudSeverity;
  status: FraudAlertStatus;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown>;
  reviewNote: string | null;
  createdAt: string;
  rule: { id: string; name: string };
  actorUser: { id: string; name: string; email: string } | null;
  reviewedBy: { id: string; name: string } | null;
}

interface RuleRow {
  id: string;
  key: FraudRuleKey;
  name: string;
  severity: FraudSeverity;
  isActive: boolean;
  config: Record<string, unknown>;
}

type TFn = (key: string, options?: Record<string, unknown>) => string;

export function FraudPage() {
  const tHook = useTranslation(['fraud', 'common']);
  const t: TFn = tHook.t;
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale);
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<'alerts' | 'rules'>('alerts');
  const [statusFilter, setStatusFilter] = useState<FraudAlertStatus | ''>('new');
  const [severityFilter, setSeverityFilter] = useState<FraudSeverity | ''>('');
  const [ruleKeyFilter, setRuleKeyFilter] = useState<FraudRuleKey | ''>('');

  const alerts = trpc.fraud.listAlerts.useQuery({
    status: (statusFilter || undefined) as FraudAlertStatus | undefined,
    severity: (severityFilter || undefined) as FraudSeverity | undefined,
    ruleKey: (ruleKeyFilter || undefined) as FraudRuleKey | undefined,
    limit: 200,
  });
  const rules = trpc.fraud.listRules.useQuery();

  const alertRows = (alerts.data ?? []) as unknown as AlertRow[];
  const ruleRows = (rules.data ?? []) as unknown as RuleRow[];

  // R7 (#729) — Fraud "kilitle": finans (page:fraud) görür ama aksiyonlar
  // yalnız yöneticide (hidden-vs-disabled rayı). Yetkisiz rolde butonlar GİZLİ.
  const canScan = usePermission('action:fraud.scanNow');
  const canReview = usePermission('action:fraud.updateAlertStatus');
  const canEditRule = usePermission('action:fraud.editRule');

  const handleError = (err: unknown) => {
    const msg = err instanceof TRPCClientError ? err.message : t('fraud:errors.unknown');
    toast.error(msg);
  };

  const updateStatus = looseFraud.updateAlertStatus.useMutation({
    onSuccess: () => {
      toast.success(t('fraud:toast.statusUpdated'));
      void utils.fraud.listAlerts.invalidate();
    },
    onError: handleError,
  });
  const toggleRule = looseFraud.toggleRule.useMutation({
    onSuccess: () => {
      toast.success(t('fraud:toast.ruleToggled'));
      void utils.fraud.listRules.invalidate();
    },
    onError: handleError,
  });
  const scan = looseFraud.scanNow.useMutation({
    onSuccess: (data) => {
      const created = (data as { created?: number } | undefined)?.created ?? 0;
      toast.success(t('fraud:toast.scanned', { count: created }));
      void utils.fraud.listAlerts.invalidate();
    },
    onError: handleError,
  });

  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(dateLocale);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('fraud:title')}
        description={t('fraud:description')}
        actions={
          canScan ? (
            <Button onClick={() => scan.mutate({})} disabled={scan.isPending}>
              {scan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <ShieldAlert className="mr-1 h-4 w-4" />
              {t('fraud:actions.scanNow')}
            </Button>
          ) : undefined
        }
      />

      <div className="flex gap-2 border-b">
        {(['alerts', 'rules'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === k
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            data-testid={`fraud-tab-${k}`}
          >
            {t(`fraud:tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'alerts' && (
        <section className="space-y-3" data-testid="fraud-alerts-tab">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="fa-status">{t('fraud:filters.status')}</Label>
              <select
                id="fa-status"
                className={SELECT_CLASS}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as FraudAlertStatus | '')}
              >
                <option value="">{t('fraud:filters.all')}</option>
                {FRAUD_ALERT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`fraud:status.${s}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fa-severity">{t('fraud:filters.severity')}</Label>
              <select
                id="fa-severity"
                className={SELECT_CLASS}
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as FraudSeverity | '')}
              >
                <option value="">{t('fraud:filters.all')}</option>
                {FRAUD_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {t(`fraud:severity.${s}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fa-rule">{t('fraud:filters.rule')}</Label>
              <select
                id="fa-rule"
                className={SELECT_CLASS}
                value={ruleKeyFilter}
                onChange={(e) => setRuleKeyFilter(e.target.value as FraudRuleKey | '')}
              >
                <option value="">{t('fraud:filters.all')}</option>
                {FRAUD_RULE_KEYS.map((r) => (
                  <option key={r} value={r}>
                    {t(`fraud:rule.${r}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {alerts.isLoading ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : alertRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('fraud:emptyAlerts')}</p>
          ) : (
            <ul className="space-y-2" data-testid="fraud-alert-list">
              {alertRows.map((a) => (
                <AlertCard
                  key={a.id}
                  alert={a}
                  canReview={canReview}
                  onUpdate={(status, note) =>
                    updateStatus.mutate({ id: a.id, status, reviewNote: note })
                  }
                  isPending={updateStatus.isPending}
                  t={t}
                  fmtDateTime={fmtDateTime}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'rules' && (
        <section className="space-y-3" data-testid="fraud-rules-tab">
          {rules.isLoading ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <ul className="space-y-2" data-testid="fraud-rule-list">
              {ruleRows.map((r) => (
                <li key={r.id} className="rounded-lg border bg-card p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{t(`fraud:rule.${r.key}`)}</div>
                      <div className="text-xs text-muted-foreground">
                        {t(`fraud:ruleDescription.${r.key}`, { defaultValue: r.name })}
                      </div>
                      <div className="mt-1">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${SEVERITY_BADGE[r.severity]}`}
                        >
                          {t(`fraud:severity.${r.severity}`)}
                        </span>
                      </div>
                    </div>
                    {canEditRule ? (
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={r.isActive}
                          onChange={(e) =>
                            toggleRule.mutate({ id: r.id, isActive: e.target.checked })
                          }
                        />
                        {t('fraud:rule.active')}
                      </label>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {r.isActive
                          ? t('fraud:rule.active')
                          : t('fraud:rule.inactive', { defaultValue: 'Pasif' })}
                      </span>
                    )}
                  </div>
                  {Object.keys(r.config).length > 0 && (
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/40 p-2 text-xs">
                      {JSON.stringify(r.config, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function AlertCard({
  alert,
  canReview,
  onUpdate,
  isPending,
  t,
  fmtDateTime,
}: {
  alert: AlertRow;
  canReview: boolean;
  onUpdate: (status: FraudAlertStatus, note?: string) => void;
  isPending: boolean;
  t: TFn;
  fmtDateTime: (iso: string) => string;
}) {
  const [askNote, setAskNote] = useState<FraudAlertStatus | null>(null);
  const [note, setNote] = useState('');

  return (
    <li className="rounded-lg border bg-card p-3 text-sm" data-testid={`fraud-alert-${alert.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs ${SEVERITY_BADGE[alert.severity]}`}>
              {t(`fraud:severity.${alert.severity}`)}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[alert.status]}`}>
              {t(`fraud:status.${alert.status}`)}
            </span>
            <span className="text-xs text-muted-foreground">{fmtDateTime(alert.createdAt)}</span>
          </div>
          <div className="font-medium">{t(`fraud:rule.${alert.ruleKey}`)}</div>
          <div className="text-xs text-muted-foreground">
            {alert.actorUser ? (
              <>
                {t('fraud:alert.actor')}: <strong>{alert.actorUser.name}</strong> (
                {alert.actorUser.email})
              </>
            ) : alert.entityType ? (
              <>
                {alert.entityType}#{alert.entityId?.slice(0, 8)}
              </>
            ) : null}
          </div>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-muted/40 p-2 text-xs">
            {JSON.stringify(alert.details, null, 2)}
          </pre>
          {alert.reviewNote && (
            <p className="text-xs italic text-muted-foreground">
              "{alert.reviewNote}"{alert.reviewedBy && <> — {alert.reviewedBy.name}</>}
            </p>
          )}
        </div>
      </div>

      {canReview && (alert.status === 'new' || alert.status === 'reviewing') ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {askNote === null ? (
            <>
              {alert.status === 'new' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => onUpdate('reviewing')}
                >
                  {t('fraud:actions.startReview')}
                </Button>
              )}
              <Button size="sm" disabled={isPending} onClick={() => setAskNote('resolved')}>
                {t('fraud:actions.resolve')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => setAskNote('false_positive')}
              >
                {t('fraud:actions.markFalsePositive')}
              </Button>
            </>
          ) : (
            <>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('fraud:actions.notePlaceholder')}
                className="max-w-md text-xs"
                data-testid="fraud-review-note"
              />
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  onUpdate(askNote, note.trim() || undefined);
                  setAskNote(null);
                  setNote('');
                }}
              >
                {t(`fraud:actions.confirm.${askNote}`)}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAskNote(null)}>
                {t('common:actions.cancel')}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
