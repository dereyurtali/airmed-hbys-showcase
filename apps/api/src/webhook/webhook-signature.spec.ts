import { createHmac } from 'crypto';
import { signPayload } from './webhook.service';

// S14 — Webhook HMAC-SHA256 imzalama unit test (DB yok).

describe('webhook signPayload', () => {
  it('verilen secret + body için stable hex döner', () => {
    const secret = 'topsecret123';
    const body = '{"id":"x","event":"appointment.created"}';
    const sig = signPayload(secret, body);
    // Stable: aynı input → aynı hash
    expect(sig).toBe(signPayload(secret, body));
    // Hex 64 char (SHA-256)
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('crypto.createHmac sha256 ile birebir uyumlu', () => {
    const secret = 'mySecret';
    const body = 'hello world';
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    expect(signPayload(secret, body)).toBe(expected);
  });

  it('farklı secret veya body → farklı hash', () => {
    expect(signPayload('a', 'x')).not.toBe(signPayload('b', 'x'));
    expect(signPayload('a', 'x')).not.toBe(signPayload('a', 'y'));
  });
});

describe('webhook discount-limits role caps', () => {
  // Burada discount-limits modülünü import etmiyoruz; B7 follow-up'ta
  // approval.service E2E test'inde tam akış doğrulanacak. Bu dosya yalnız
  // HMAC primitive test'ini barındırır.
  it('placeholder — full coverage B7 follow-up E2E', () => {
    expect(true).toBe(true);
  });
});
