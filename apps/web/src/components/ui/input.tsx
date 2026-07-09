import * as React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * Alan-içi hata (Bölüm 24.4): zemin BEYAZ kalır (okunabilirlik), yalnız
   * kenar kızarır (#FFD1CE), focus'ta #B42318. `aria-invalid` da set edilir.
   */
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, readOnly, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      readOnly={readOnly}
      aria-invalid={error || undefined}
      className={cn(
        'focus-ring flex h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-[color:var(--ph)] file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:cursor-not-allowed disabled:opacity-50',
        'border-field hover:border-field-hover',
        // Read-only = dolu nötr zemin (disabled görünümü DEĞİL; "sistem sağladı").
        readOnly && 'cursor-default bg-[color:var(--ro)] hover:border-field',
        // Hata = beyaz zemin + kırmızı kenar; focus'ta koyu kırmızı kenar.
        error && 'border-critical-border focus-visible:border-[color:var(--crit-tx)]',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
