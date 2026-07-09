import { Children, cloneElement, isValidElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Label } from '../ui/label';

interface FormFieldProps {
  label: string;
  error?: string;
  description?: string;
  required?: boolean;
  /**
   * Single form control element (Input, select, textarea). The wrapper clones
   * it to inject `id`, `aria-invalid`, and `aria-describedby` so the Label and
   * the error message are programmatically associated.
   */
  children: ReactNode;
}

interface CloneableProps {
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
}

export function FormField({ label, error, description, required, children }: FormFieldProps) {
  const fieldId = useId();
  const errorId = error ? `${fieldId}-error` : undefined;
  const descId = description ? `${fieldId}-desc` : undefined;
  const describedBy = [errorId, descId].filter(Boolean).join(' ') || undefined;

  // Only one form control is expected. We accept ReactNode so callers can
  // pass arbitrary content, but we only inject a11y props on the first
  // valid element child — keep that surface tight.
  const child = Children.toArray(children).find(isValidElement) as
    | ReactElement<CloneableProps>
    | undefined;
  const enhanced = child
    ? cloneElement(child, {
        id: fieldId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        'aria-required': required ? true : undefined,
      })
    : children;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId}>
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </Label>
      {enhanced}
      {description && !error && (
        <p id={descId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
