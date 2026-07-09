import { forwardRef, useEffect, useState } from 'react';
import { cn } from '../../lib/utils';

// SİS-5 — Native <input type=date/datetime-local/time> yasak (tasarım anayasası
// Böl. 5): 3 dilde tarayıcı-bağımlı format bug'ı + tablet UX. Yerine maskeli
// metin alanları (GG.AA.YYYY / SS:DD). Değer kontratı native ile birebir aynı:
//   DateField      → 'yyyy-mm-dd'
//   TimeField      → 'hh:mm'
//   DateTimeField  → 'yyyy-mm-ddThh:mm'
// Böylece çağıran taraf (Zod şema, backend) hiç değişmeden çalışır.

const inputCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums ' +
  'ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

// ---- DateField ---------------------------------------------------------------

function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

// Kullanıcı girişini GG.AA.YYYY maskesine sok (yalnız rakam + otomatik nokta).
function maskDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  const parts = [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean);
  return parts.join('.');
}

function displayToIso(display: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(display);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const day = +dd;
  const month = +mm;
  const year = +yyyy;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return null;
  const date = new Date(year, month - 1, day);
  // Taşma kontrolü (örn. 31.02 → Mart'a kayar).
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${yyyy}-${mm}-${dd}`;
}

export interface DateFieldProps {
  value: string; // 'yyyy-mm-dd' veya ''
  onChange: (iso: string) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/** Maskeli GG.AA.YYYY tarih alanı. Geçerli tarih oluşunca ISO emit eder. */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { value, onChange, id, name, disabled, className, placeholder = 'GG.AA.YYYY', ...aria },
  ref,
) {
  const [text, setText] = useState(() => isoToDisplay(value));

  // Dış value değişince (reset/prefill) metni senkronla — kullanıcı yazarken değil.
  useEffect(() => {
    setText(isoToDisplay(value));
  }, [value]);

  return (
    <input
      ref={ref}
      id={id}
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      className={cn(inputCls, className)}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const masked = maskDate(e.target.value);
        setText(masked);
        const iso = displayToIso(masked);
        if (iso) onChange(iso);
        else if (masked === '') onChange('');
      }}
      {...aria}
    />
  );
});

// ---- TimeField ---------------------------------------------------------------

function maskTime(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2, 4)}`;
}

function validTime(t: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return false;
  return +m[1] <= 23 && +m[2] <= 59;
}

export interface TimeFieldProps {
  value: string; // 'hh:mm' veya ''
  onChange: (hhmm: string) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/** Maskeli SS:DD (24 saat) alanı. */
export const TimeField = forwardRef<HTMLInputElement, TimeFieldProps>(function TimeField(
  { value, onChange, id, name, disabled, className, placeholder = 'SS:DD', ...aria },
  ref,
) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      ref={ref}
      id={id}
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      className={cn(inputCls, className)}
      placeholder={placeholder}
      value={text}
      {...aria}
      onChange={(e) => {
        const masked = maskTime(e.target.value);
        setText(masked);
        if (validTime(masked)) onChange(masked);
        else if (masked === '') onChange('');
      }}
    />
  );
});

// ---- DateTimeField -----------------------------------------------------------

export interface DateTimeFieldProps {
  value: string; // 'yyyy-mm-ddThh:mm' veya ''
  onChange: (v: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/** GG.AA.YYYY + SS:DD ikilisi → 'yyyy-mm-ddThh:mm'. */
export function DateTimeField({ value, onChange, id, disabled, className }: DateTimeFieldProps) {
  const [datePart, timePart] = value.includes('T') ? value.split('T') : [value, ''];
  const emit = (d: string, t: string) => {
    if (d && t) onChange(`${d}T${t}`);
    else if (!d && !t) onChange('');
    else onChange(`${d}T${t}`); // kısmi — geçerli olana kadar tutulur
  };
  return (
    <div className={cn('flex gap-2', className)}>
      <DateField
        id={id}
        value={datePart}
        onChange={(d) => emit(d, timePart)}
        disabled={disabled}
        className="flex-1"
      />
      <TimeField
        value={timePart}
        onChange={(t) => emit(datePart, t)}
        disabled={disabled}
        className="w-24"
      />
    </div>
  );
}
