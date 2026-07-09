import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

// Bölüm 24.3 — PrimaryButton: tek aksan #0166A8; r8; 600; loading = etiket
// kalır + sol spinner; tek focus ring (.focus-ring, klavye-only). Dekoratif
// ikon yok. `secondary` = nötr araç butonu (beyaz zemin + ince kenar).
const buttonVariants = cva(
  'focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary:
          'border border-field bg-background text-muted-foreground hover:border-field-hover hover:bg-[color:var(--hover)]',
        destructive: 'bg-[color:var(--crit-pure)] text-white hover:opacity-90',
        outline:
          'border border-field bg-background hover:bg-[color:var(--hover)] hover:text-foreground',
        ghost: 'hover:bg-[color:var(--hover)] hover:text-foreground',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-lg px-3',
        lg: 'h-11 rounded-lg px-8',
        icon: 'h-10 w-10',
        // Touch-friendly variants (≥44px) for dense clinical touch surfaces (tablet/banko).
        touch: 'h-11 rounded-lg px-4',
        'icon-touch': 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Loading: etiket kalır, sol spinner görünür, buton disabled (Bölüm 24.4). */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    // asChild (Slot) tek React-element child ister — loading spinner enjekte
    // edilmez (Slot çoklu child'da patlar). Spinner yalnız gerçek <button>'da.
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
