import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

// #1056 — locale JSON'ları (3 dil × 36 ns ≈ entry'nin ~yarısı) artık dile göre
// bölünür: TR (fallback) statik bundled; RU/TG kendi chunk'ında, aktif dil
// olduğunda lazyLocaleBackend üzerinden yüklenir. main.tsx ilk render'ı
// initI18n()'e bağlar → RU/TG kullanıcısı raw-key/TR flash'ı görmez.
import trResources from './resources.tr';

export const SUPPORTED_LOCALES = ['tr', 'ru', 'tg'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const FALLBACK_LOCALE: SupportedLocale = 'tr';
export const STORAGE_KEY = 'airmed_locale';

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

// changeLanguage yükleme bitmeden dili değiştirmez → geçişte eski dil kalır,
// eksik-anahtar flash'ı olmaz. Chunk yüklenemezse (ör. offline) callback err
// döner; i18next fallbackLng (TR) ile devam eder.
const lazyLocaleBackend = {
  type: 'backend' as const,
  init: () => undefined,
  read: (lng: string, ns: string, callback: (err: unknown, data?: unknown) => void) => {
    import(`./resources.${lng}.ts`)
      .then((mod: { default: Record<string, object> }) => callback(null, mod.default[ns]))
      .catch((err: unknown) => callback(err));
  },
};

const initPromise = i18n
  .use(lazyLocaleBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { tr: trResources },
    // Bundled TR'ye ek dilleri backend'den tamamla.
    partialBundledLanguages: true,
    fallbackLng: FALLBACK_LOCALE,
    supportedLngs: SUPPORTED_LOCALES as readonly string[] as string[],
    nonExplicitSupportedLngs: true,
    ns: [
      'common',
      'auth',
      'patient',
      'doctor',
      'appointment',
      'examination',
      'measurement',
      'clinical',
      'photo',
      'dashboard',
      'surgery',
      'lab',
      'iol',
      'postOp',
      'procedure',
      'preOp',
      'reports',
      'pharmacy',
      'commission',
      'fraud',
      'consent',
      'messaging',
      'billing',
      'notification',
      'worklist',
      'measurementOrder',
      'surgerySales',
      'feedback',
      'receptionQueue',
      'safety',
      'encounter',
      'nurse',
      'recall',
      'cosign',
      'pastExaminations',
      'setup',
      'guide',
    ],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
    returnNull: false,
  });

/** İlk render'dan önce beklenir: aktif dil RU/TG ise chunk'ı gelmiş olur. */
export function initI18n(): Promise<unknown> {
  return initPromise;
}

export default i18n;
