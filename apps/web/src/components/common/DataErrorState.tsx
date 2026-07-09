import { AlertTriangle, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';

// SİS-6 — Veri-çeken sayfalar için tek error+retry bloğu. Eskiden query.error
// dalı olmayan sayfalar hatayı "veri yok" / sonsuz skeleton gibi gösteriyordu.
// `onRetry` genelde react-query `refetch`.
export function DataErrorState({
  onRetry,
  message,
  className,
}: {
  onRetry?: () => void;
  message?: string;
  className?: string;
}) {
  const { t } = useTranslation('common');
  return (
    <div
      role="alert"
      className={
        'flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center ' +
        (className ?? '')
      }
    >
      <AlertTriangle className="h-8 w-8 text-destructive/70" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t('states.error')}</p>
        <p className="max-w-sm text-xs text-muted-foreground">{message ?? t('states.errorHint')}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          {t('actions.retry')}
        </Button>
      )}
    </div>
  );
}
