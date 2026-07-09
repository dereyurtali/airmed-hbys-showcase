import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, LOCALES, translate, type Locale } from './messages';

const STORAGE_KEY = 'platform.locale';

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && (LOCALES as string[]).includes(v)) return v as Locale;
  } catch {
    // localStorage unavailable (private mode / SSR) — fall through to default.
  }
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const l = readStoredLocale();
    document.documentElement.lang = l;
    return l;
  });

  const setLocale = useCallback((l: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // Persist is best-effort; runtime switch still works without it.
    }
    document.documentElement.lang = l;
    setLocaleState(l);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

/** Convenience: just the translator. */
export function useT(): I18nValue['t'] {
  return useI18n().t;
}
