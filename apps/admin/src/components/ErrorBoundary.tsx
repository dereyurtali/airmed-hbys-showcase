import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';
import { captureException } from '../lib/sentry';
import { translate, DEFAULT_LOCALE, type Locale } from '../i18n';

// #943/#926 — Platform admin top-level ErrorBoundary (apps/web/src/components/
// ErrorBoundary.tsx portu). React subtree throw ederse fallback UI gösterir;
// aksi halde beyaz ekran + telemetri yok. Sınıf bileşeni (hook yok) + crash
// anında i18n context'i güvenilmez olduğu için metin useT() yerine saf
// translate() ile üretilir; locale localStorage'dan senkron okunur (context'e
// bağımlı değil). VITE_SENTRY_DSN set ise componentDidCatch hatayı Sentry/
// GlitchTip'e gönderir (PII scrub'lı); DSN yoksa captureException no-op.

const LOCALE_STORAGE_KEY = 'platform.locale';

function currentLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (v === 'tr' || v === 'en') return v;
  } catch {
    // localStorage erişilemez (özel mod) — varsayılana düş.
  }
  return DEFAULT_LOCALE;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

interface Props {
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Best-effort telemetry. componentStack dev'de değerli; prod'da minified.
    console.error('[ErrorBoundary]', error, info.componentStack);
    captureException(error, { componentStack: info.componentStack });
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  private handleHome = (): void => {
    // Hard reload: bozuk state'i sıfırlamanın en güvenli yolu.
    window.location.href = '/';
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const locale = currentLocale();
    const t = (key: string): string => translate(locale, key);
    const message = this.state.error?.message ?? t('errorBoundary.unknown');
    const isDev = import.meta.env.DEV;

    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40 p-6">
        <div className="max-w-md w-full bg-background border border-border rounded-lg shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-amber-100 p-2">
              <AlertTriangle className="h-6 w-6 text-amber-600" aria-hidden />
            </div>
            <h1 className="text-lg font-semibold text-foreground">{t('errorBoundary.title')}</h1>
          </div>

          <p className="text-sm text-muted-foreground">{t('errorBoundary.body')}</p>

          {isDev && (
            <pre className="text-xs bg-muted text-muted-foreground rounded p-3 overflow-x-auto max-h-48">
              {message}
            </pre>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium transition hover:bg-primary/90"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t('errorBoundary.retry')}
            </button>
            <button
              type="button"
              onClick={this.handleHome}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted/50"
            >
              <Home className="h-4 w-4" aria-hidden />
              {t('errorBoundary.home')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
