import { createHmac, timingSafeEqual } from 'crypto';

// A12 — Internal sync endpoint HMAC auth.
//
// Tasarım: shared secret (SYNC_HMAC_SECRET) iki node arasında. İstek header'ı
// `X-Sync-Signature: <hex hmac sha256>` ile birlikte gelir; receiver imzayı
// body üstünde yeniden hesaplar ve timingSafeEqual ile karşılaştırır.
//
// Replay defense: header `X-Sync-Timestamp` (unix epoch sec) + 5dk pencere
// dışında istek reddedilir. Timestamp imzaya dahil edilir → tamper imkansız.

const TIMESTAMP_WINDOW_SEC = 300;

export interface SyncSignature {
  signature: string;
  timestamp: string;
}

export function signSyncBody(secret: string, body: string, timestamp: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function buildSyncHeaders(secret: string, body: string): SyncSignature {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return { signature: signSyncBody(secret, body, timestamp), timestamp };
}

export function verifySyncSignature(
  secret: string,
  body: string,
  signature: string | undefined,
  timestamp: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!signature || !timestamp) return { ok: false, reason: 'missing signature/timestamp' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid timestamp' };
  const drift = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (drift > TIMESTAMP_WINDOW_SEC) return { ok: false, reason: 'timestamp out of window' };

  const expected = signSyncBody(secret, body, timestamp);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return { ok: false, reason: 'signature length mismatch' };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'signature mismatch' };
  return { ok: true };
}
