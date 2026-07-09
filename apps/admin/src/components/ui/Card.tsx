import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** Beyaz yüzey, 1px #D9DEE7, r8, gölgesiz (airmed-design Bölüm 24.3). */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-lg border border-border bg-background', className)}>{children}</div>
  );
}

interface SectionCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}

/** Başlıklı bölüm kartı — SectionHeader 15/600 + opsiyonel sağ aksiyon. */
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  testId,
}: SectionCardProps) {
  return (
    <Card className={cn('p-5 sm:p-6', className)}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold leading-tight text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div data-testid={testId}>{children}</div>
    </Card>
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Sayfa başlığı — 18/600 + opsiyonel açıklama + sağ aksiyon. */
export function PageHeader({ title, description, action, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div>
        <h1 className="text-lg font-semibold leading-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
