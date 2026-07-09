import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SectionHeaderProps {
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

// Bölüm 24 — bölüm başlığı: 15/600 + opsiyonel sağ aksiyon slotu.
export function SectionHeader({ title, action, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
