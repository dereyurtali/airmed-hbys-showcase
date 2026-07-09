import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle2, Printer } from 'lucide-react';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { getReceiptAutoprintMode } from '../../lib/receipt-prefs';
import { cn } from '../../lib/utils';

/**
 * Resepsiyon Genel Bakış üst şeridi — sunucu/sync/makbuz durumu tek bakışta.
 * Gerçek sinyal (anti-AI): bağlantı + outbox = useSyncStatus, makbuz tercihi =
 * localStorage. Durum = tint + ince kenar + ikon + metin (renk tek başına değil).
 */

type Tone = 'ok' | 'warn' | 'crit' | 'muted';

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  crit: 'border-rose-200 bg-rose-50 text-rose-700',
  muted: 'border-border bg-muted text-muted-foreground',
};

function StatusPill({
  icon: Icon,
  tone,
  children,
  to,
}: {
  icon: ComponentType<{ className?: string }>;
  tone: Tone;
  children: React.ReactNode;
  to?: string;
}) {
  const className = cn(
    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium',
    TONE_CLASSES[tone],
  );
  const content = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="tabular-nums">{children}</span>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={`${className} transition-colors hover:brightness-95`}>
        {content}
      </Link>
    );
  }
  return <span className={className}>{content}</span>;
}

export function SystemStatusStrip() {
  const { t } = useTranslation('common');
  const { status, offline, isLoading } = useSyncStatus();
  const receiptMode = getReceiptAutoprintMode();

  // Bağlantı pill'i
  const connection = offline ? (
    <StatusPill icon={WifiOff} tone="crit">
      {t('overview.systemStatus.offline')}
    </StatusPill>
  ) : (
    <StatusPill icon={Wifi} tone="ok">
      {t('overview.systemStatus.online')}
    </StatusPill>
  );

  // Sync pill'i — peer yoksa biriken normal (uyarma), yerel göster
  let sync: React.ReactNode = null;
  if (!isLoading && status) {
    if (status.outboxFailed > 0) {
      sync = (
        <StatusPill icon={AlertTriangle} tone="warn">
          {t('overview.systemStatus.syncFailed', { count: status.outboxFailed })}
        </StatusPill>
      );
    } else if (status.outboxPending > 5 && status.peerConfigured) {
      sync = (
        <StatusPill icon={RefreshCw} tone="warn">
          {t('overview.systemStatus.syncPending', { count: status.outboxPending })}
        </StatusPill>
      );
    } else if (!status.peerConfigured) {
      sync = (
        <StatusPill icon={CheckCircle2} tone="muted">
          {t('overview.systemStatus.syncLocal')}
        </StatusPill>
      );
    } else {
      sync = (
        <StatusPill icon={CheckCircle2} tone="ok">
          {t('overview.systemStatus.syncOk')}
        </StatusPill>
      );
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('overview.systemStatus.label')}
      className="flex flex-wrap items-center gap-2"
    >
      {connection}
      {sync}
      <StatusPill icon={Printer} tone="muted" to="/reception/preferences">
        {receiptMode === 'auto'
          ? t('overview.systemStatus.receiptAuto')
          : t('overview.systemStatus.receiptManual')}
      </StatusPill>
    </div>
  );
}
