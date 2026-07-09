import type { LucideIcon } from 'lucide-react';
import type { Tone } from './Badge';
import { cn } from '../../lib/cn';

const TINT: Record<Tone, string> = {
  neutral: 'bg-[var(--minor)] text-muted-foreground',
  primary: 'bg-[var(--info-bg)] text-[var(--info-tx)]',
  critical: 'bg-[var(--crit-bg)] text-[var(--crit-tx)]',
  warning: 'bg-[var(--warn-bg)] text-[var(--warn-tx)]',
  success: 'bg-[var(--suc-bg)] text-[var(--suc-tx)]',
  info: 'bg-[var(--info-bg)] text-[var(--info-tx)]',
};

interface Props {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tint?: Tone;
  className?: string;
  testId?: string;
}

/** KPI kartı — başlık 13/600 + değer 22/600 + alt-satır 12 muted; grafik yok (Bölüm 24.3). */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tint = 'primary',
  className,
  testId,
}: Props) {
  return (
    <div
      data-testid={testId}
      className={cn('rounded-lg border border-border bg-background p-4', className)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-semibold text-muted-foreground">{label}</div>
        {Icon && (
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', TINT[tint])}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      <div className="mt-1.5 text-[22px] font-semibold tabular-nums leading-tight text-foreground">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
