import * as React from 'react';
import { cn } from '../../lib/utils';

// Bölüm 24 — statik iskelet (shimmer/animasyon YOK; dikkat dağıtmaz).
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg bg-[color:var(--neutral-tint)]', className)} {...props} />;
}
