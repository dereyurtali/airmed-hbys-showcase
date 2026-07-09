import * as React from 'react';
import { cn } from '../../lib/utils';

// Bölüm 24 — metadata etiketi: h-5, nötr (anlamsal renk taşımaz).
export function Tag({ className, children, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-badge bg-[color:var(--minor)] px-2 text-xs font-medium text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
