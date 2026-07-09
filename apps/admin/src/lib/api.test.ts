import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setUnauthorizedHandler } from './api';

function mockFetch(
  body: unknown,
  init: { status?: number; statusText?: string; text?: string } = {},
) {
  const status = init.status ?? 200;
  const text = init.text ?? (body === undefined ? '' : JSON.stringify(body));
  return vi.fn(() =>
    Promise.resolve({
      ok: status < 400,
      status,
      statusText: init.statusText ?? '',
      text: () => Promise.resolve(text),
    } as unknown as Response),
  );
}

describe('api()', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch({ ok: true }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('default GET, credentials include, JSON content-type', async () => {
    const fetchSpy = mockFetch({ data: 'x' });
    globalThis.fetch = fetchSpy as typeof fetch;
    await api<{ data: string }>('/platform/tenants');
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/platform/tenants');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('bearer token Authorization header eklenir', async () => {
    const fetchSpy = mockFetch({});
    globalThis.fetch = fetchSpy as typeof fetch;
    await api('/x', { bearer: 'tok-123' });
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('query string undefined/null/empty atılır, geri kalan encode edilir', async () => {
    const fetchSpy = mockFetch({});
    globalThis.fetch = fetchSpy as typeof fetch;
    await api('/x', {
      query: { a: 'foo bar', b: undefined, c: '', d: 42, e: true },
    });
    const [url] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/x?a=foo%20bar&d=42&e=true');
  });

  it('POST body otomatik JSON.stringify', async () => {
    const fetchSpy = mockFetch({});
    globalThis.fetch = fetchSpy as typeof fetch;
    await api('/x', { method: 'POST', body: { hello: 'world' } });
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"hello":"world"}');
  });

  it('204 No Content → undefined', async () => {
    globalThis.fetch = mockFetch(undefined, { status: 204 }) as typeof fetch;
    const out = await api<undefined>('/x', { method: 'DELETE' });
    expect(out).toBeUndefined();
  });

  it('400 → ApiError("bad_request"), backend message tercih edilir', async () => {
    globalThis.fetch = mockFetch(
      { message: 'invalid input' },
      { status: 400, statusText: 'Bad Request' },
    ) as typeof fetch;
    await expect(api('/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'bad_request',
      message: 'invalid input',
    });
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [412, 'precondition_failed'],
    [429, 'rate_limited'],
    [500, 'server_error'],
    [503, 'server_error'],
    [418, 'error'],
  ])('status %i → code %s', async (status, code) => {
    globalThis.fetch = mockFetch(null, { status, statusText: 'X' }) as typeof fetch;
    await expect(api('/x')).rejects.toBeInstanceOf(ApiError);
    try {
      await api('/x');
    } catch (err) {
      expect((err as ApiError).code).toBe(code);
    }
  });

  it('non-JSON error body → statusText message fallback', async () => {
    globalThis.fetch = mockFetch(null, {
      status: 502,
      statusText: 'Bad Gateway',
      text: '<html>nginx</html>',
    }) as typeof fetch;
    await expect(api('/x')).rejects.toMatchObject({
      status: 502,
      code: 'server_error',
      message: 'Bad Gateway',
    });
  });
});

describe('ApiError', () => {
  it('name = ApiError, status + code public', () => {
    const e = new ApiError(403, 'forbidden', 'denied');
    expect(e.name).toBe('ApiError');
    expect(e.status).toBe(403);
    expect(e.code).toBe('forbidden');
    expect(e.message).toBe('denied');
  });
});

describe('unauthorized handler (#404 global 401)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setUnauthorizedHandler(null);
  });

  it('fires the registered handler on 401', async () => {
    globalThis.fetch = mockFetch(null, { status: 401 }) as typeof fetch;
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(api('/x')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire on 403 (forbidden ≠ expired session)', async () => {
    globalThis.fetch = mockFetch(null, { status: 403 }) as typeof fetch;
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(api('/x')).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not throw when no handler is registered', async () => {
    globalThis.fetch = mockFetch(null, { status: 401 }) as typeof fetch;
    setUnauthorizedHandler(null);
    await expect(api('/x')).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
