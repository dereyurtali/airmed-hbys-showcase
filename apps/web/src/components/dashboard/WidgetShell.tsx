import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// S14 — Widget kabuğu (loading/error/empty state'leri tek yerden). Her widget
// type'ı aynı kabuğu reuse eder.

interface WidgetShellProps {
  title: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: { message: string } | null;
  empty?: boolean;
  emptyLabel?: string;
  children?: ReactNode;
  className?: string;
}

export function WidgetShell({
  title,
  icon,
  loading,
  error,
  empty,
  emptyLabel,
  children,
  className,
}: WidgetShellProps) {
  const { t } = useTranslation('common');
  return (
    <div
      className={
        'rounded-lg border bg-background overflow-hidden flex flex-col ' + (className ?? '')
      }
    >
      <header className="px-4 py-2 border-b border-border flex items-center gap-2">
        {icon && (
          <span className="text-muted-foreground" aria-hidden>
            {icon}
          </span>
        )}
        <h3 className="text-sm font-medium text-muted-foreground truncate">{title}</h3>
      </header>
      <div className="flex-1 p-4 min-h-0">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            <div className="h-2 w-2 bg-[color:var(--neutral-tint)] rounded-full mr-2" />
            {t('loading')}
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center gap-1 text-xs text-critical-foreground">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <span className="text-center">{error.message}</span>
          </div>
        ) : empty ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            {emptyLabel ?? t('noData')}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
