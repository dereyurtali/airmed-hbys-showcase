import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ListRowProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
}

// Bölüm 24 — liste satırı: min-h 40 (2-satır → 48); hover row-tint; seçili = info tint; gölge YOK.
export const ListRow = React.forwardRef<HTMLDivElement, ListRowProps>(
  ({ className, selected, onClick, ...props }, ref) => {
    const interactive = Boolean(onClick);
    return (
      <div
        ref={ref}
        onClick={onClick}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        className={cn(
          'flex min-h-10 items-center gap-3 px-3 py-2 transition-colors',
          interactive && 'focus-ring cursor-pointer',
          selected ? 'bg-info-bg' : interactive && 'hover:bg-[color:var(--row-hover)]',
          className,
        )}
        {...props}
      />
    );
  },
);
ListRow.displayName = 'ListRow';
