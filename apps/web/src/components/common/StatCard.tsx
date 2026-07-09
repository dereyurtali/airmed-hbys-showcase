import * as React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

export interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** Set edildiğinde ön-filtreli route'a tıklanabilir kart (react-router Link). */
  to?: string;
  onClick?: () => void;
  className?: string;
}

// Bölüm 24 — StatCard: değer 22/600, etiket 13/600 muted, alt-satır 12 muted.
// Grafik YOK. Tıklanabilirse yalnız hover tint. Tıkla → ön-filtreli route.
export function StatCard({ label, value, sub, to, onClick, className }: StatCardProps) {
  const interactive = Boolean(to || onClick);
  const content = (
    <>
      <div className="text-[13px] font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 text-[22px] font-semibold leading-none">{value}</div>
      {sub && <div className="mt-1 text-[12px] text-muted-foreground">{sub}</div>}
    </>
  );

  const base = cn(
    'block rounded-lg border border-border bg-background p-4 text-left',
    interactive && 'focus-ring transition-colors hover:bg-[color:var(--hover)]',
    className,
  );

  if (to) {
    return (
      <Link to={to} className={base}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(base, 'w-full')}>
        {content}
      </button>
    );
  }
  return <div className={base}>{content}</div>;
}
