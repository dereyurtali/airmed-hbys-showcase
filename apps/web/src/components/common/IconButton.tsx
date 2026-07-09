import * as React from 'react';
import { cn } from '../../lib/utils';

// Bölüm 24 — 36×36 ikon butonu: hover tint, tek focus ring. lucide ikon (1.5 stroke) tutar.
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, type = 'button', children, ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      'focus-ring inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
      className,
    )}
    {...props}
  >
    {children}
  </button>
));
IconButton.displayName = 'IconButton';
