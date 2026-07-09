import * as React from 'react';
import { CircleAlert, TriangleAlert, CircleCheck, Info } from 'lucide-react';
import { cn } from '../../lib/utils';

// Bölüm 24 — Banner (Alert): tint zemin + ince kenar + metin, renkli sol bar YOK.
// 18px ikon + başlık 13/600 + opsiyonel gövde 12/400.
type AlertTone = 'error' | 'warning' | 'success' | 'info';

const TONE: Record<AlertTone, { cls: string; Icon: typeof Info }> = {
  error: {
    cls: 'border-critical-border bg-critical-bg text-critical-foreground',
    Icon: CircleAlert,
  },
  warning: {
    cls: 'border-warning-border bg-warning-bg text-warning-foreground',
    Icon: TriangleAlert,
  },
  success: {
    cls: 'border-success-border bg-success-bg text-success-foreground',
    Icon: CircleCheck,
  },
  info: {
    cls: 'border-info-border bg-info-bg text-info-foreground',
    Icon: Info,
  },
};

export interface AlertProps {
  tone: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
}

export function Alert({ tone, title, children }: AlertProps) {
  const { cls, Icon } = TONE[tone];
  return (
    <div role="alert" className={cn('flex gap-2.5 rounded-lg border p-3', cls)}>
      <Icon size={18} strokeWidth={1.5} className="mt-px shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <div className="text-[13px] font-semibold">{title}</div>}
        {children && (
          <div className={cn('text-[12px] font-normal', title && 'mt-0.5')}>{children}</div>
        )}
      </div>
    </div>
  );
}
