import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Input } from '../ui/input';

interface ChipsInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  maxItems?: number;
  maxLength?: number;
  ariaLabel?: string;
}

/**
 * S15-PR1 — Allerji / antikoagülan vb. açık-kelime tıbbi terim listeleri için
 * basit chip input. Enter veya virgül ile chip ekler; X ile siler; Backspace
 * boş input'ta son chip'i siler. XSS guard: <>& yasak (backend zod ile aynı).
 */
export function ChipsInput({
  value,
  onChange,
  placeholder,
  maxItems = 30,
  maxLength = 100,
  ariaLabel,
}: ChipsInputProps) {
  const [draft, setDraft] = useState('');

  const sanitize = (s: string) => s.trim().replace(/[<>&]/g, '').slice(0, maxLength);

  const commit = (raw: string) => {
    const clean = sanitize(raw);
    if (!clean) return;
    if (value.includes(clean)) {
      setDraft('');
      return;
    }
    if (value.length >= maxItems) return;
    onChange([...value, clean]);
    setDraft('');
  };

  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft.length === 0 && value.length > 0) {
      remove(value.length - 1);
    }
  };

  return (
    <div className="flex w-full flex-wrap gap-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring">
      {value.map((chip, idx) => (
        <span
          key={`${chip}-${idx}`}
          className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs"
        >
          {chip}
          <button
            type="button"
            onClick={() => remove(idx)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Sil: ${chip}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Input
        className="h-7 flex-1 border-0 bg-transparent px-1 py-0 text-xs shadow-none focus-visible:ring-0"
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, maxLength))}
        onBlur={() => commit(draft)}
        onKeyDown={handleKey}
        placeholder={value.length === 0 ? placeholder : ''}
        aria-label={ariaLabel}
        disabled={value.length >= maxItems}
      />
    </div>
  );
}
