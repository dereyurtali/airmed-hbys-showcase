import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ChipProps {
  active?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

// Bölüm 24 — filtre çipi: h-8; aktif = info tint; opsiyonel × ile kaldırılır.
export function Chip({ active, onRemove, onClick, children, className }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors',
        active
          ? 'border-info-border bg-info-bg font-semibold text-info-foreground'
          : 'border-field text-muted-foreground hover:bg-[color:var(--hover)]',
        className,
      )}
    >
      {children}
      {onRemove && (
        <span
          role="button"
          tabIndex={-1}
          aria-label="Kaldır"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-1 inline-flex items-center justify-center rounded-sm opacity-70 hover:opacity-100"
        >
          <X size={12} strokeWidth={2} aria-hidden />
        </span>
      )}
    </button>
  );
}
