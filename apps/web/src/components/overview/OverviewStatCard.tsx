import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Genel Bakış KPI kutusu — v0.4.2 Tema 2: her KPI **tıkla → ön-filtreli route**.
 * `to` verilirse <Link> (klavye erişilebilir, hover affordance ok); yoksa düz kutu.
 * Marka gradient veri yüzeyinde yok; airmed-design StatCard kalıbı (rounded-xl, tint pill).
 */

const TINT: Record<string, string> = {
  sky: 'bg-sky-50 text-sky-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  violet: 'bg-violet-50 text-violet-600',
};

export type OverviewTint = keyof typeof TINT;

interface OverviewStatCardProps {
  icon: LucideIcon;
  tint: OverviewTint;
  value: ReactNode;
  label: string;
  /** Tıklanınca gidilecek ön-filtreli route (Tema 2). Verilmezse kutu tıklanmaz. */
  to?: string;
  /** Sağ üst köşe rozeti (örn. "Canlı"). */
  badge?: ReactNode;
  /** #1036 — dikey sıkışık varyant (otomasyon KPI şeridi gibi ikincil ekranlar). */
  compact?: boolean;
  className?: string;
}

export function OverviewStatCard({
  icon: Icon,
  tint,
  value,
  label,
  to,
  badge,
  compact,
  className,
}: OverviewStatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between">
        <span
          className={cn(
            'flex items-center justify-center rounded-xl',
            compact ? 'h-9 w-9' : 'h-11 w-11',
            TINT[tint],
          )}
          aria-hidden
        >
          <Icon className="h-5 w-5" strokeWidth={1.5} />
        </span>
        {badge ??
          (to && (
            <ArrowUpRight
              className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden
            />
          ))}
      </div>
      <div
        className={cn(
          'font-semibold tabular-nums tracking-tight',
          compact ? 'mt-2 text-2xl' : 'mt-4 text-3xl',
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </>
  );

  const base = cn('block rounded-xl border bg-background', compact ? 'p-3' : 'p-5');

  if (to) {
    return (
      <Link
        to={to}
        data-testid="overview-statcard"
        className={cn(
          'group',
          base,
          'transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        {body}
      </Link>
    );
  }

  return (
    <div data-testid="overview-statcard" className={cn(base, className)}>
      {body}
    </div>
  );
}
