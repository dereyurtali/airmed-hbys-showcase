// Ortak Sentry/GlitchTip event scrubber — EPIC #812 / I1.1 (#813) 🚦GATE.
//
// FE (@sentry/react) + BE (@sentry/node) `beforeSend` hook'una bağlanır. SDK
// dışına çıkan event'i **allowlist** ile yeniden inşa eder: boş bir event'ten
// başlar, yalnız bilinen-güvenli alanları kopyalar/şekillendirir. Denylist
// DEĞİL — yeni bir Sentry alanı default olarak DIŞARI çıkamaz.
//
// Atılır:  request body, query string, cookie, allowlist-dışı header, frame
//          local'leri (vars), abs_path (dev kullanıcı adı içerir), breadcrumb
//          data, user.email/name/ip, extra (serbest), bilinmeyen contexts/tags.
// Tutulur: error type, scrub'lı stack (dosya/fonksiyon/satır), route pattern,
//          HTTP method+status, rol/mod/locale/sürüm tag'leri, opak user.id,
//          os/runtime/app/browser/trace context'leri (değerleri redakte).
//
// Tutulan serbest-metin alanları (exception value, breadcrumb message) ayrıca
// `scrubText` ile redakte edilir → ikinci PII ağı.

import { routePattern, scrubText, sourcePath } from './redact';

/** Sentry event'in dokunduğumuz alt kümesi (yapısal tip — SDK'ya bağımlı değil). */
export interface ScrubbableEvent {
  event_id?: string;
  timestamp?: number | string;
  platform?: string;
  level?: string;
  logger?: string;
  environment?: string;
  release?: string;
  dist?: string;
  sdk?: unknown;
  transaction?: string;
  fingerprint?: string[];
  exception?: { values?: ExceptionValue[] };
  request?: Record<string, unknown>;
  user?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: Breadcrumb[];
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ExceptionValue {
  type?: string;
  value?: string;
  module?: string;
  stacktrace?: { frames?: StackFrame[] };
  [key: string]: unknown;
}

interface StackFrame {
  filename?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  [key: string]: unknown;
}

interface Breadcrumb {
  type?: string;
  category?: string;
  level?: string;
  timestamp?: number;
  message?: string;
  [key: string]: unknown;
}

// Korunan tag anahtarları (bizim set ettiğimiz teknik bağlam).
const ALLOWED_TAG_KEYS = new Set([
  'role',
  'mode',
  'locale',
  'app_version',
  'release',
  'environment',
  'feature',
  'screen',
  'http.method',
  'http.status_code',
  'level',
  'handled',
  'mechanism',
]);
// Tag değeri route-pattern'e indirilecek anahtarlar (URL içerebilir).
const ROUTE_TAG_KEYS = new Set(['url', 'transaction']);

// Korunan context blokları (PII'sız teknik). device/culture/geo atılır.
const ALLOWED_CONTEXT_KEYS = new Set(['os', 'runtime', 'app', 'browser', 'trace']);

// request'ten korunan alanlar (header/cookie/body/query string ASLA).
function shapeRequest(req: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof req.method === 'string') out.method = req.method;
  if (typeof req.url === 'string') out.url = routePattern(req.url);
  return out;
}

function shapeUser(user: Record<string, unknown>): Record<string, unknown> {
  // Yalnız opak id (UUID/hash). email/username/ip_address/geo atılır. id yine de
  // scrubText'ten geçer: uygulama yanlışlıkla email/isim koymuşsa maskelenir
  // (gerçek UUID hiçbir PII desenine uymaz → değişmeden geçer).
  const out: Record<string, unknown> = {};
  if (typeof user.id === 'string') out.id = scrubText(user.id);
  else if (typeof user.id === 'number') out.id = user.id;
  return out;
}

function shapeTags(tags: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(tags)) {
    if (ROUTE_TAG_KEYS.has(key) && typeof val === 'string') {
      out[key] = routePattern(val);
    } else if (ALLOWED_TAG_KEYS.has(key)) {
      out[key] = typeof val === 'string' ? scrubText(val) : val;
    }
  }
  return out;
}

function shapeContexts(contexts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(contexts)) {
    if (ALLOWED_CONTEXT_KEYS.has(key) && val && typeof val === 'object') {
      out[key] = deepRedact(val, 0);
    }
  }
  return out;
}

function shapeFrame(frame: StackFrame): StackFrame {
  // abs_path + vars (local değişken değerleri) + pre/post context atılır.
  const out: StackFrame = {};
  if (typeof frame.filename === 'string') out.filename = sourcePath(frame.filename);
  if (typeof frame.function === 'string') out.function = frame.function;
  if (typeof frame.module === 'string') out.module = frame.module;
  if (typeof frame.lineno === 'number') out.lineno = frame.lineno;
  if (typeof frame.colno === 'number') out.colno = frame.colno;
  if (typeof frame.in_app === 'boolean') out.in_app = frame.in_app;
  return out;
}

function shapeException(exception: { values?: ExceptionValue[] }): { values?: ExceptionValue[] } {
  if (!Array.isArray(exception.values)) return {};
  return {
    values: exception.values.map((v) => {
      const out: ExceptionValue = {};
      if (typeof v.type === 'string') out.type = v.type;
      if (typeof v.value === 'string') out.value = scrubText(v.value);
      if (typeof v.module === 'string') out.module = v.module;
      if (v.stacktrace && Array.isArray(v.stacktrace.frames)) {
        out.stacktrace = { frames: v.stacktrace.frames.map(shapeFrame) };
      }
      return out;
    }),
  };
}

function shapeBreadcrumbs(crumbs: Breadcrumb[]): Breadcrumb[] {
  return crumbs.map((c) => {
    // data atılır (navigation from/to URL, fetch payload, vb.).
    const out: Breadcrumb = {};
    if (typeof c.type === 'string') out.type = c.type;
    if (typeof c.category === 'string') out.category = c.category;
    if (typeof c.level === 'string') out.level = c.level;
    if (typeof c.timestamp === 'number') out.timestamp = c.timestamp;
    if (typeof c.message === 'string') out.message = scrubText(c.message);
    return out;
  });
}

const MAX_DEPTH = 6;

/** Bilinmeyen yapıyı güvenli kopyalar: string→redakte, primitif→tut, fn→at. */
function deepRedact(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[derinlik-aşıldı]';
  if (typeof value === 'string') return scrubText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepRedact(v, depth + 1);
    }
    return out;
  }
  return undefined; // function / symbol / undefined → düşür
}

/**
 * Sentry `beforeSend` scrubber. Boş event'ten allowlist ile yeniden inşa eder.
 * `null` dönmez (event yine de gönderilir, ama scrub'lı); gönderimi tümden
 * iptal etmek SDK init tarafının kararı.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (!event || typeof event !== 'object') return event;
  const out: ScrubbableEvent = {};

  // Düz, PII'sız meta alanlar.
  if (typeof event.event_id === 'string') out.event_id = event.event_id;
  if (event.timestamp !== undefined) out.timestamp = event.timestamp;
  if (typeof event.platform === 'string') out.platform = event.platform;
  if (typeof event.level === 'string') out.level = event.level;
  if (typeof event.logger === 'string') out.logger = event.logger;
  if (typeof event.environment === 'string') out.environment = event.environment;
  if (typeof event.release === 'string') out.release = event.release;
  if (typeof event.dist === 'string') out.dist = event.dist;
  if (event.sdk !== undefined) out.sdk = event.sdk;

  // transaction → route pattern.
  if (typeof event.transaction === 'string') out.transaction = routePattern(event.transaction);

  // fingerprint → her parça redakte.
  if (Array.isArray(event.fingerprint)) {
    out.fingerprint = event.fingerprint.map((f) => (typeof f === 'string' ? scrubText(f) : f));
  }

  if (event.exception && typeof event.exception === 'object') {
    out.exception = shapeException(event.exception);
  }
  if (event.request && typeof event.request === 'object') {
    out.request = shapeRequest(event.request);
  }
  if (event.user && typeof event.user === 'object') {
    out.user = shapeUser(event.user);
  }
  if (event.tags && typeof event.tags === 'object') {
    out.tags = shapeTags(event.tags);
  }
  if (event.contexts && typeof event.contexts === 'object') {
    out.contexts = shapeContexts(event.contexts);
  }
  if (Array.isArray(event.breadcrumbs)) {
    out.breadcrumbs = shapeBreadcrumbs(event.breadcrumbs);
  }

  // extra + message + diğer her şey → KASITLI olarak DÜŞÜRÜLÜR (allowlist).

  return out as T;
}
