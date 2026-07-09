import { lookup } from 'dns/promises';

// #937 — Webhook SSRF guard. URL şeması https doğrulanmış olsa da hostname
// private/loopback/link-local bir IP'ye çözülebilir (ör. 127.0.0.1, 169.254.x,
// 10.x, metadata endpoint'i). Delivery ÖNCESİ hostname'i çöz + private aralıkları
// reddet. Not: DNS-rebinding (TOCTOU) tam kapatılmaz — webhook yalnız yönetici
// tarafından oluşturulur (düşük risk); bu, açık SSRF'i bloklar (defense in depth).

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) || // link-local (cloud metadata)
    a >= 224 // multicast + reserved
  );
}

function isPrivateIpv6(ip: string): boolean {
  const l = ip.toLowerCase();
  if (l === '::1' || l === '::') return true; // loopback / unspecified
  if (l.startsWith('::ffff:')) return isPrivateIpv4(l.slice(7)); // IPv4-mapped
  return l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80'); // ULA + link-local
}

export async function assertPublicWebhookUrl(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') {
    throw new Error(`Webhook URL must be https (got ${url.protocol})`);
  }
  // IPv6 URL hostname'i köşeli parantezli gelir ([::1]) → lookup için soy.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let results: { address: string; family: number }[];
  try {
    results = await lookup(host, { all: true });
  } catch {
    throw new Error(`Webhook host DNS resolution failed: ${host}`);
  }
  if (results.length === 0) {
    throw new Error(`Webhook host did not resolve: ${host}`);
  }
  for (const r of results) {
    const isPrivate = r.family === 4 ? isPrivateIpv4(r.address) : isPrivateIpv6(r.address);
    if (isPrivate) {
      throw new Error(`Webhook URL resolves to a private/loopback address (SSRF blocked): ${host}`);
    }
  }
}
