import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';
import { captureException } from '../lib/sentry';

// S14 — v0.1 ErrorBoundary port. Top-level catch (App.tsx en üstünde wrap edilir).
// React subtree throw ederse fallback UI gösterir; aksi halde production'da
// uygulamayı kırar. i18n yok — fallback statik metin (kullanıcı dil tercihi
// state olabileceği için risk almıyoruz).
//
// VITE_SENTRY_DSN set ise componentDidCatch hatayı Sentry'ye gönderir; DSN yoksa
// captureException no-op kalır, yalnız console.error çalışır.

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
    // Hard reload: state'i sıfırlamak için en güvenli yol. Kullanıcı login
    // gerektirebilir, ama bozuk state'le devam etmek daha kötü. '/' → HomeRedirect
    // rol-bazlı landing'e yollar (#908: sabit /dashboard emekli).
    window.location.href = '/';
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const message = this.state.error?.message ?? 'Bilinmeyen bir hata oluştu';
    const isDev = import.meta.env.DEV;

    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40 p-6">
        <div className="max-w-md w-full bg-background border border-border rounded-lg shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-amber-100 p-2">
              <AlertTriangle className="h-6 w-6 text-amber-600" aria-hidden />
            </div>
            <h1 className="text-lg font-semibold text-foreground">Bir şeyler ters gitti</h1>
          </div>

          <p className="text-sm text-muted-foreground">
            Beklenmeyen bir hata oluştu. Tekrar denemek veya ana sayfaya dönmek için aşağıdaki
            butonları kullanabilirsiniz. Sorun devam ederse sistem yöneticisiyle iletişime geçin.
          </p>

          {isDev && (
            <pre className="text-xs bg-muted text-muted-foreground rounded p-3 overflow-x-auto max-h-48">
              {message}
            </pre>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 text-white px-3 py-2 text-sm font-medium hover:bg-slate-800 transition"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Tekrar Dene
            </button>
            <button
              type="button"
              onClick={this.handleHome}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-background px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 transition"
            >
              <Home className="h-4 w-4" aria-hidden />
              Ana Sayfa
            </button>
          </div>
        </div>
      </div>
    );
  }
}
