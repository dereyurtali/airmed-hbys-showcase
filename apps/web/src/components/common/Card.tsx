import * as React from 'react';
import { cn } from '../../lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  dense?: boolean;
}

// Bölüm 24 — yüzey kartı: r8 + ince kenar, gölge YOK (yalnız yüzen yüzeyler gölgeli).
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, dense, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border border-border bg-background',
        dense ? 'p-3' : 'p-4',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-2', className)} {...props} />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(className)} {...props} />;
}
