import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SpinnerProps {
  size?: number;
  className?: string;
}

// Bölüm 24 — tek dönen yükleme göstergesi.
export function Spinner({ size = 20, className }: SpinnerProps) {
  return (
    <Loader2
      size={size}
      strokeWidth={1.5}
      className={cn('animate-spin text-muted-foreground', className)}
      aria-hidden
    />
  );
}
