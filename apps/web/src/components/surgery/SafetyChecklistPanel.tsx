import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';
import { usePermission } from '../../hooks/usePermission';
import { useLocale } from '../../providers/LocaleProvider';
import { formatDateTime } from '../../lib/i18n-format';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  itemMapKey,
  SAFETY_PHASES,
  type SafetyChecklistPhase,
} from '../../lib/safety-checklist.constants';

interface Props {
  surgeryId: string;
}

/**
 * S15-PR3 — WHO Surgical Safety Checklist paneli. tRPC ile catalog (21 item
 * meta) + state (items + phaseStatus) fetch eder; her item check toggle,
 * phase complete butonları, fullyComplete rozeti.
 *
 * PR9'da SurgeryDayCenterPage intra-op aşamasının kapısı: signIn +
 * timeOut tamam olmadan ameliyat başlatılamaz (`canStartIntraOp`).
 */
export function SafetyChecklistPanel({ surgeryId }: Props) {
  const { t } = useTranslation(['safety', 'common']);
  const { locale } = useLocale();
  const canConfirm = usePermission('action:surgicalSafetyCheck.confirm');
  const utils = trpc.useUtils();
  const [activePhase, setActivePhase] = useState<SafetyChecklistPhase>('sign_in');

  const catalog = trpc.surgery.safetyChecklist.catalog.useQuery();
  const state = trpc.surgery.safetyChecklist.get.useQuery({ surgeryId });

  const confirm = trpc.surgery.safetyChecklist.confirmItem.useMutation({
    onSuccess: () => utils.surgery.safetyChecklist.get.invalidate({ surgeryId }),
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });
  const markPhase = trpc.surgery.safetyChecklist.markPhase.useMutation({
    onSuccess: () => {
      utils.surgery.safetyChecklist.get.invalidate({ surgeryId });
      toast.success(t('safety:phase.markedComplete'));
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  const itemsByPhase = useMemo(() => {
    const items = catalog.data ?? [];
    return SAFETY_PHASES.reduce(
      (acc, phase) => {
        acc[phase] = items.filter((it) => it.phase === phase);
        return acc;
      },
      { sign_in: [], time_out: [], sign_out: [] } as Record<SafetyChecklistPhase, typeof items>,
    );
  }, [catalog.data]);

  if (catalog.isLoading || state.isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!catalog.data || !state.data) {
    return (
      <p className="text-sm text-destructive">
        {t('safety:errors.loadFailed', { message: catalog.error?.message ?? state.error?.message })}
      </p>
    );
  }

  const itemState = state.data.items;
  const phaseStatus = state.data.phaseStatus;
  const activeItems = itemsByPhase[activePhase];

  const requiredAllDone = activeItems
    .filter((it) => it.required)
    .every((it) => itemState[itemMapKey(it)]?.confirmed === true);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {t('safety:title')}
        </div>
        {state.data.fullyComplete && <Badge variant="success">{t('safety:fullyComplete')}</Badge>}
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {SAFETY_PHASES.map((phase, idx) => {
          const status = phaseStatus[phase];
          // #410 — WHO faz sırası: önceki faz tamamlanmadan sonraki kilitli
          // (sign_in → time_out → sign_out). Atlanamaz güvenlik akışı.
          const prevPhase = idx > 0 ? SAFETY_PHASES[idx - 1] : null;
          const locked = prevPhase ? !phaseStatus[prevPhase].complete : false;
          return (
            <button
              key={phase}
              type="button"
              onClick={() => !locked && setActivePhase(phase)}
              disabled={locked}
              title={
                locked
                  ? t('safety:phase.lockedHint', { defaultValue: 'Önceki fazı tamamlayın' })
                  : undefined
              }
              className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                activePhase === phase
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground enabled:hover:bg-background/50'
              }`}
            >
              <span className="inline-flex items-center gap-1">
                {status.complete ? (
                  <CheckCircle2 className="h-3 w-3 text-success-foreground" />
                ) : (
                  <Circle className="h-3 w-3" />
                )}
                {t(`safety:phase.${phase}`)}
              </span>
            </button>
          );
        })}
      </div>

      <ul className="space-y-2">
        {activeItems.map((item) => {
          const key = itemMapKey(item);
          const itm = itemState[key];
          const confirmed = itm?.confirmed === true;
          return (
            <li
              key={key}
              className={`flex items-start gap-3 rounded-lg border p-3 ${
                confirmed ? 'border-success-border bg-success-bg' : 'border-border'
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  confirm.mutate({
                    surgeryId,
                    itemKey: key,
                    confirmed: !confirmed,
                  })
                }
                disabled={!canConfirm || confirm.isPending}
                className="mt-0.5 shrink-0 disabled:opacity-50"
                aria-label={confirmed ? t('safety:item.uncheck') : t('safety:item.check')}
              >
                {confirmed ? (
                  <CheckCircle2 className="h-5 w-5 text-success-foreground" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" />
                )}
              </button>
              <div className="flex-1 space-y-0.5">
                <p className="text-sm">{t(item.i18nLabelKey)}</p>
                {!item.required && (
                  <p className="text-[10px] uppercase text-muted-foreground">
                    {t('safety:item.optional')}
                  </p>
                )}
                {confirmed && itm?.confirmedAt && (
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(itm.confirmedAt, locale)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {canConfirm && !phaseStatus[activePhase].complete && (
        <Button
          type="button"
          onClick={() => markPhase.mutate({ surgeryId, phase: activePhase })}
          disabled={!requiredAllDone || markPhase.isPending}
        >
          {markPhase.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('safety:phase.markComplete', { phase: t(`safety:phase.${activePhase}`) })}
        </Button>
      )}
    </div>
  );
}
