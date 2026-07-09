import { describe, it, expect } from 'vitest';
import { scrubEvent, type ScrubbableEvent } from './scrubber';

// Sentetik PII havuzu — çıktının HİÇBİRİNİ içermemesi GATE şartı.
const PII = {
  email: 'hasta@klinik.tj',
  mrn: 'TD26700042',
  phone: '+992 90 123 45 67',
  tckn: '12345678901',
  name: 'Ayşe Yılmaz',
  cookie: 'session=abc.def.ghi',
  body: 'diagnosis: glokom; iol: SN60WF',
  devPath: '/Users/alid/DNA-Projects/airmed-hbys/apps/api/src/patient/patient.service.ts',
};

// Gerçekçi, PII ile dolu ham bir Sentry event'i (allowlist-dışı her yere PII serpiştirildi).
function dirtyEvent(): ScrubbableEvent {
  return {
    event_id: 'evt-1',
    timestamp: 1234567890,
    platform: 'node',
    level: 'error',
    environment: 'production',
    release: 'abc123sha',
    message: `Patient ${PII.email} ${PII.mrn} crashed`,
    transaction: `/patients/${PII.mrn}/exams/55`,
    fingerprint: [`patient-${PII.mrn}`],
    exception: {
      values: [
        {
          type: 'PrismaClientKnownRequestError',
          value: `Unique constraint failed for ${PII.email} phone ${PII.phone}`,
          stacktrace: {
            frames: [
              {
                filename: PII.devPath,
                abs_path: PII.devPath,
                function: 'PatientService.create',
                lineno: 42,
                colno: 7,
                in_app: true,
                vars: { email: PII.email, tckn: PII.tckn, name: PII.name },
                pre_context: [`const email = "${PII.email}"`],
              },
            ],
          },
        },
      ],
    },
    request: {
      method: 'POST',
      url: `https://demoeye.hbys.dnasoft.co/api/patients/${PII.mrn}?q=${PII.email}`,
      query_string: `email=${PII.email}`,
      cookies: PII.cookie,
      headers: { authorization: 'Bearer secret-token', cookie: PII.cookie },
      data: { tckn: PII.tckn, name: PII.name, body: PII.body },
    },
    user: {
      id: 'user-uuid-opaque',
      email: PII.email,
      username: PII.name,
      ip_address: '88.12.34.56',
    },
    tags: {
      role: 'doktor',
      mode: 'asistan',
      locale: 'tr',
      url: `https://demoeye.hbys.dnasoft.co/patients/${PII.mrn}`,
      patient_email: PII.email,
    },
    contexts: {
      os: { name: 'macOS', version: '14.0' },
      runtime: { name: 'node', version: '20' },
      trace: { trace_id: 'opaque-trace', span_id: 'opaque-span' },
      device: { name: `${PII.name} MacBook`, model: 'MacBookPro18,1' },
    },
    breadcrumbs: [
      {
        type: 'navigation',
        category: 'navigation',
        level: 'info',
        timestamp: 1234567880,
        data: { from: '/login', to: `/patients/${PII.mrn}` },
      },
      {
        type: 'http',
        category: 'fetch',
        message: `GET /api/patients/${PII.mrn} for ${PII.email}`,
        timestamp: 1234567885,
      },
    ],
    extra: {
      patientEmail: PII.email,
      requestBody: PII.body,
      tckn: PII.tckn,
    },
  };
}

// Event'i derin JSON string'e indirger; PII string araması bunun üstünde yapılır.
function flatten(event: unknown): string {
  return JSON.stringify(event);
}

describe('scrubEvent — GATE: 0 PII', () => {
  it('hiçbir PII değeri çıktıda kalmaz', () => {
    const out = scrubEvent(dirtyEvent());
    const flat = flatten(out);

    expect(flat).not.toContain(PII.email);
    expect(flat).not.toContain(PII.mrn);
    expect(flat).not.toContain('12345678901'); // tckn
    expect(flat).not.toContain(PII.name);
    expect(flat).not.toContain(PII.cookie);
    expect(flat).not.toContain(PII.body);
    expect(flat).not.toContain('Bearer secret-token');
    expect(flat).not.toContain('88.12.34.56'); // ip
    expect(flat).not.toContain('/Users/alid'); // dev abs_path → kullanıcı adı
    // Ayrık telefon parçaları da kalmamalı.
    expect(flat).not.toContain('992');
  });

  it('teknik bağlamı korur (debug edilebilirlik)', () => {
    const out = scrubEvent(dirtyEvent());
    expect(out.exception?.values?.[0].type).toBe('PrismaClientKnownRequestError');
    expect(out.exception?.values?.[0].stacktrace?.frames?.[0].function).toBe(
      'PatientService.create',
    );
    expect(out.exception?.values?.[0].stacktrace?.frames?.[0].lineno).toBe(42);
    expect(out.level).toBe('error');
    expect(out.environment).toBe('production');
    expect(out.release).toBe('abc123sha');
    expect(out.platform).toBe('node');
    expect(out.event_id).toBe('evt-1');
  });

  it('route pattern: id değerleri :id olur', () => {
    const out = scrubEvent(dirtyEvent());
    expect(out.transaction).toBe('/patients/:id/exams/:id');
    expect(out.request?.url).toBe('https://demoeye.hbys.dnasoft.co/api/patients/:id');
    expect(out.request?.method).toBe('POST');
  });

  it('request: body/header/cookie/query string tümden düşer', () => {
    const out = scrubEvent(dirtyEvent());
    expect(out.request).toBeDefined();
    expect(out.request).not.toHaveProperty('headers');
    expect(out.request).not.toHaveProperty('cookies');
    expect(out.request).not.toHaveProperty('data');
    expect(out.request).not.toHaveProperty('query_string');
    expect(Object.keys(out.request ?? {}).sort()).toEqual(['method', 'url']);
  });

  it('user: yalnız opak id kalır', () => {
    const out = scrubEvent(dirtyEvent());
    expect(out.user).toEqual({ id: 'user-uuid-opaque' });
  });

  it('user.id yanlışlıkla PII ise maskelenir (savunma)', () => {
    const out = scrubEvent({ user: { id: 'hasta@klinik.tj' } } as ScrubbableEvent);
    expect(out.user).toEqual({ id: '[e-posta]' });
  });

  it('tags: allowlist + url route-pattern, bilinmeyen tag düşer', () => {
    const out = scrubEvent(dirtyEvent());
    expect(out.tags?.role).toBe('doktor');
    expect(out.tags?.mode).toBe('asistan');
    expect(out.tags?.locale).toBe('tr');
    expect(out.tags?.url).toBe('https://demoeye.hbys.dnasoft.co/patients/:id');
    expect(out.tags).not.toHaveProperty('patient_email');
  });

  it('contexts: allowlist (os/runtime/trace), device düşer', () => {
    const out = scrubEvent(dirtyEvent());
    expect(out.contexts).toHaveProperty('os');
    expect(out.contexts).toHaveProperty('runtime');
    expect(out.contexts).toHaveProperty('trace');
    expect(out.contexts).not.toHaveProperty('device');
  });

  it('stack frame: vars + abs_path + pre_context düşer', () => {
    const out = scrubEvent(dirtyEvent());
    const frame = out.exception?.values?.[0].stacktrace?.frames?.[0] ?? {};
    expect(frame).not.toHaveProperty('vars');
    expect(frame).not.toHaveProperty('abs_path');
    expect(frame).not.toHaveProperty('pre_context');
    // filename proje-göreli: makine/kullanıcı dizini sızmaz.
    expect(frame.filename).toBe('apps/api/src/patient/patient.service.ts');
  });

  it('breadcrumb: data düşer, message redakte', () => {
    const out = scrubEvent(dirtyEvent());
    const nav = out.breadcrumbs?.[0] ?? {};
    expect(nav).not.toHaveProperty('data');
    expect(nav.category).toBe('navigation');
    const http = out.breadcrumbs?.[1];
    expect(http?.message).toContain('[mrn]');
    expect(http?.message).not.toContain(PII.email);
  });

  it('extra + message → tümden düşer (allowlist)', () => {
    const out = scrubEvent(dirtyEvent());
    expect(out).not.toHaveProperty('extra');
    expect(out).not.toHaveProperty('message');
  });

  it('boş / bozuk girdi güvenli', () => {
    expect(scrubEvent({} as ScrubbableEvent)).toEqual({});
    expect(scrubEvent(null as unknown as ScrubbableEvent)).toBeNull();
  });
});
