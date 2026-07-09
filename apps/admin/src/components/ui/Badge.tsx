import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type Tone = 'neutral' | 'primary' | 'critical' | 'warning' | 'success' | 'info';

const TONE: Record<Tone, string> = {
  neutral: 'bg-[var(--minor)] text-muted-foreground',
  primary: 'bg-[var(--info-bg)] text-[var(--info-tx)] border border-[var(--info-bd)]',
  critical: 'bg-[var(--crit-bg)] text-[var(--crit-tx)] border border-[var(--crit-bd)]',
  warning: 'bg-[var(--warn-bg)] text-[var(--warn-tx)] border border-[var(--warn-bd)]',
  success: 'bg-[var(--suc-bg)] text-[var(--suc-tx)] border border-[var(--suc-bd)]',
  info: 'bg-[var(--info-bg)] text-[var(--info-tx)] border border-[var(--info-bd)]',
};

/** Durum/sayı rozeti — renk + metin (Bölüm 24.4); r6, 12/600. */
export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-semibold',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
