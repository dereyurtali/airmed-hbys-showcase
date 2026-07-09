import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

type Tone = 'error' | 'warning' | 'success' | 'info';

const TONE: Record<Tone, { cls: string; Icon: typeof Info }> = {
  error: {
    cls: 'bg-[var(--crit-bg)] border-[var(--crit-bd)] text-[var(--crit-tx)]',
    Icon: XCircle,
  },
  warning: {
    cls: 'bg-[var(--warn-bg)] border-[var(--warn-bd)] text-[var(--warn-tx)]',
    Icon: AlertTriangle,
  },
  success: {
    cls: 'bg-[var(--suc-bg)] border-[var(--suc-bd)] text-[var(--suc-tx)]',
    Icon: CheckCircle2,
  },
  info: { cls: 'bg-[var(--info-bg)] border-[var(--info-bd)] text-[var(--info-tx)]', Icon: Info },
};

/** Form/sayfa-geneli banner — tint zemin + ince kenar + ikon + metin (Bölüm 24.4). */
export function Alert({
  tone = 'info',
  className,
  children,
  testId,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const { cls, Icon } = TONE[tone];
  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn('flex items-start gap-2 rounded-lg border p-3 text-[13px]', cls, className)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
