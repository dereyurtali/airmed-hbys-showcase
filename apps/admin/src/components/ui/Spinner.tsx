import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

/** <1s yükleme için spinner (Bölüm 24.4). */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}
