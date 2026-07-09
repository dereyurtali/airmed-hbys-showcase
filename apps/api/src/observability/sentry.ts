import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { scrubEvent, type ScrubbableEvent } from '@airmed/observability';

// Merkezi hata izleme. SENTRY_DSN env'i set DEĞİLSE tamamen dormant kalır
// (initSentry no-op, captureException no-op) — pilot/dev'de hiçbir şey gönderilmez,
// sadece DSN girilince aktifleşir. Yalnız manuel captureException kullanıyoruz
// (exception filter + tRPC onError); HTTP auto-instrumentation/trace KAPALI çünkü:
//   - performans trace'i maliyet + gürültü (klinik trafiği için gereksiz),
//   - auto request-capture hasta PII'sını Sentry'ye sızdırabilir (KVKK).

let initialized = false;

// Ortam etiketi: staging + prod ikisi de NODE_ENV=production koşar (iki ayrı
// GlitchTip örneği: prod→klinik, staging→staging-box). İkisini ayırmak için açık
// SENTRY_ENVIRONMENT verilir; yoksa NODE_ENV'e düşer.
function resolveEnvironment(): string {
  return process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const environment = resolveEnvironment();
  Sentry.init({
    dsn,
    environment,
    // Release = deploy edilen git SHA (deploy.sh / compose APP_RELEASE inject eder).
    // Set değilse SDK release'i atlar (eski davranış).
    release: process.env.APP_RELEASE || undefined,
    // Sadece hata izleme; performans tracing kapalı.
    tracesSampleRate: 0,
    // PII redaksiyonu: request body/headers/cookie otomatik eklenmez.
    sendDefaultPii: false,
    // KVKK GATE (I1.1 #813): ortak allowlist scrubber — gönderimden önce
    // event yeniden inşa edilir, hasta PII'si transmisyondan çıkar.
    beforeSend: (event) =>
      scrubEvent(event as unknown as ScrubbableEvent) as unknown as typeof event,
  });
  initialized = true;
  new Logger('Sentry').log(
    `error tracking enabled (env: ${environment}` +
      (process.env.APP_RELEASE ? `, release: ${process.env.APP_RELEASE}` : '') +
      ')',
  );
}

/**
 * Beklenmeyen hatayı Sentry'ye gönderir. Dormant ise sessizce no-op.
 * `context` yalnızca non-PII teknik bağlam içermeli (path, status, UUID id'ler) —
 * hasta verisi / serbest metin GÖNDERME.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
