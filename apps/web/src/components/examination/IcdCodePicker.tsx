import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '../ui/input';
import { trpc } from '../../lib/trpc';
import { useLocale } from '../../providers/LocaleProvider';

interface IcdMatch {
  code: string;
  category: string;
  tr: string;
  ru: string;
  tg: string;
}

interface Props {
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

// ICD-10 autocomplete picker. Locale'a göre eşleşen etiketten gösterir.
// Seçilenler chip olarak alt satırda; tıklayınca kaldırır.
export function IcdCodePicker({ value, onChange, disabled }: Props) {
  const { t } = useTranslation('examination');
  const { locale } = useLocale();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const searchQuery = trpc.icd.search.useQuery(
    { query, locale, limit: 15 },
    { enabled: query.length >= 1, staleTime: 30 * 1000 },
  );
  const matches = (searchQuery.data as IcdMatch[] | undefined) ?? [];

  const selectedQuery = trpc.icd.getByCodes.useQuery(
    { codes: Array.from(value) },
    { enabled: value.length > 0, staleTime: 5 * 60 * 1000 },
  );
  const selected = (selectedQuery.data as IcdMatch[] | undefined) ?? [];

  const labelOf = (m: IcdMatch) => (locale === 'ru' ? m.ru : locale === 'tg' ? m.tg : m.tr);

  const add = (code: string) => {
    if (value.includes(code)) return;
    onChange([...value, code]);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const remove = (code: string) => {
    onChange(value.filter((c) => c !== code));
  };

  const visibleMatches = useMemo(
    () => matches.filter((m) => !value.includes(m.code)),
    [matches, value],
  );

  // Click outside → close dropdown
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!inputRef.current?.parentElement?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t('icd.searchPlaceholder')}
          disabled={disabled}
          aria-label={t('icd.searchPlaceholder')}
        />
        {open && query.length > 0 && visibleMatches.length > 0 && (
          <ul
            className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-lg"
            role="listbox"
          >
            {visibleMatches.map((m) => (
              <li key={m.code}>
                <button
                  type="button"
                  onClick={() => add(m.code)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="font-mono text-xs text-primary">{m.code}</span>
                  <span className="flex-1">{labelOf(m)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && query.length > 0 && !searchQuery.isLoading && visibleMatches.length === 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">
            {t('icd.noMatch')}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((m) => (
            <span
              key={m.code}
              className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-900"
            >
              <span className="font-mono">{m.code}</span>
              <span>·</span>
              <span>{labelOf(m)}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(m.code)}
                  aria-label={t('icd.remove', { code: m.code })}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-blue-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
