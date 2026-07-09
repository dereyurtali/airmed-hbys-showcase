import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '../../lib/utils';

export interface LabelProps extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {
  /** Zorunlu alan yıldızı (Bölüm 24.4) — kırmızı `*` eklenir. */
  required?: boolean;
}

// Etiket: 13/600 (Bölüm 24.1). Zorunlu yıldızı opsiyonel; FormField wrapper'ı
// hâlâ kendi yıldızını basabilir, bu prop standalone kullanım için.
export const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(
        'text-[13px] font-semibold leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    >
      {children}
      {required && (
        <span className="ml-0.5 text-[color:var(--crit-tx)]" aria-hidden>
          *
        </span>
      )}
    </LabelPrimitive.Root>
  ),
);
Label.displayName = LabelPrimitive.Root.displayName;
