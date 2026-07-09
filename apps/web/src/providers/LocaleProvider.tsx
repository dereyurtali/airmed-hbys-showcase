import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FALLBACK_LOCALE,
  STORAGE_KEY,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  isSupportedLocale,
} from '../i18n';
import { trpc } from '../lib/trpc';
import { useAuth } from './AuthProvider';

interface LocaleContextValue {
  locale: SupportedLocale;
  supported: readonly SupportedLocale[];
  setLocale: (locale: SupportedLocale) => Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const { isAuthenticated } = useAuth();

  const me = trpc.auth.me.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const setLocaleMutation = trpc.user.setLocale.useMutation();

  // Apply DB locale ONCE on first successful fetch after auth — subsequent
  // refetches must not override an in-session switch. Without the ref guard,
  // every me.data refresh would clobber the user's pick (e.g. RU → revert TR).
  const dbLocaleAppliedRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated) {
      dbLocaleAppliedRef.current = false;
      return;
    }
    if (dbLocaleAppliedRef.current) return;
    const dbLocale = me.data?.locale;
    if (!dbLocale || !isSupportedLocale(dbLocale)) return;
    dbLocaleAppliedRef.current = true;
    if (i18n.language !== dbLocale) {
      void i18n.changeLanguage(dbLocale);
      try {
        localStorage.setItem(STORAGE_KEY, dbLocale);
      } catch {
        // localStorage unavailable (private mode etc.) — ignore
      }
    }
  }, [isAuthenticated, me.data?.locale, i18n]);

  const setLocale = useCallback(
    async (next: SupportedLocale) => {
      await i18n.changeLanguage(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      if (isAuthenticated) {
        try {
          await setLocaleMutation.mutateAsync({ locale: next });
        } catch {
          // Server rejected — UI stays on the picked locale; next /me will reconcile
        }
      }
    },
    [i18n, isAuthenticated, setLocaleMutation],
  );

  const value = useMemo<LocaleContextValue>(() => {
    const current = isSupportedLocale(i18n.language) ? i18n.language : FALLBACK_LOCALE;
    return { locale: current, supported: SUPPORTED_LOCALES, setLocale };
  }, [i18n.language, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
