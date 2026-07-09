import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// Bölüm 24.3 — Badge (durum/sayı): 20px · r6 (rounded-badge) · 12/600 ·
// renk + metin (durum = tint zemin + ince kenar + metin). Kanonik eşleme:
//   Sırada → neutral · Ölçümde → warning · Ölçüm hazır → success ·
//   Ödenmemiş → critical · Ameliyat satışta → primary (info).
// Eski variant'lar (default/secondary/outline) geriye-uyum için korunur.
const badgeVariants = cva(
  'inline-flex h-5 items-center gap-1 rounded-badge px-2 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-muted text-muted-foreground',
        outline: 'border border-field text-foreground',
        // Durum (tint + kenar + metin):
        neutral: 'bg-[color:var(--neutral-tint)] text-muted-foreground',
        success: 'border border-success-border bg-success-bg text-success-foreground',
        warning: 'border border-warning-border bg-warning-bg text-warning-foreground',
        critical: 'border border-critical-border bg-critical-bg text-critical-foreground',
        info: 'border border-info-border bg-info-bg text-info-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Opsiyonel 7px durum noktası (Bölüm 24.3). */
  dot?: boolean;
}

export function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, className }))} {...props}>
      {dot && <span className="h-[7px] w-[7px] rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export { badgeVariants };
