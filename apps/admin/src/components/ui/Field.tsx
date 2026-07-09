import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/cn';

const CONTROL =
  'focus-ring w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground ' +
  'placeholder:text-[var(--ph)] transition-colors duration-100 ease-swift ' +
  'disabled:cursor-not-allowed disabled:bg-[var(--ro)] read-only:bg-[var(--ro)]';

/** airmed-design Bölüm 24.4 — alan-içi hata: kenar kırmızı, zemin beyaz kalır, mesaj altta. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(CONTROL, 'h-10', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea ref={ref} className={cn(CONTROL, 'py-2 leading-relaxed', className)} {...rest} />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn(CONTROL, 'h-10 cursor-pointer', className)} {...rest}>
        {children}
      </select>
    );
  },
);

interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

/** Etiket + kontrol + hata sarmalayıcı. Etiket 13/600, hata 12/500 critical. */
export function Field({ label, htmlFor, error, hint, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-foreground">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs font-medium text-[var(--crit-tx)]">
          {error}
        </p>
      )}
    </div>
  );
}
