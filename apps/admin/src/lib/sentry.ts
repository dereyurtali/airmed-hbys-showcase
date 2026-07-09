import { scrubEvent, type ScrubbableEvent } from '@airmed/observability';

// #943/#926 — Platform admin frontend hata izleme (apps/web/src/lib/sentry.ts
// birebir portu). VITE_SENTRY_DSN set DEĞİLSE tamamen dormant (no-op) — pilot/
// dev'de hiçbir şey gönderilmez. Yalnız manuel captureException (ErrorBoundary)
// kullanılır; otomatik PII/replay/trace KAPALI (KVKK + maliyet).
//
// #1068 — SDK dinamik yüklenir (web #1056 deseni): DSN yokken @sentry/react
// bundle'a hiç girmez; DSN varken ayrı async chunk olarak gelir.

type SentryModule = typeof import('@sentry/react');

let sentry: SentryModule | null = null;

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  void import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn,
      // staging + prod ikisi de MODE=production build'ler; iki ayrı GlitchTip
      // örneğini ayırmak için açık override.
      environment:
        (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? import.meta.env.MODE,
      // Release = deploy edilen git SHA (build-time __APP_RELEASE__); source map
      // yüklemesiyle (vite.config.ts sentry plugin) eşleşir → okunabilir stack.
      release: __APP_RELEASE__,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      // KVKK GATE (I1.1 #813): ortak allowlist scrubber — gönderimden önce
      // event yeniden inşa edilir, PII transmisyondan çıkar.
      beforeSend: (event) =>
        scrubEvent(event as unknown as ScrubbableEvent) as unknown as typeof event,
    });
    sentry = Sentry;
  });
}

/** Dormant ise sessizce no-op. `context` yalnız non-PII teknik bağlam içermeli. */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!sentry) return;
  sentry.captureException(err, context ? { extra: context } : undefined);
}
