/**
 * Minimal IPv4 CIDR matcher. We avoid `ip-cidr` because v4+ is ESM-only and
 * trips ts-jest under our current config; the allowlist surface is small
 * (parse a CIDR, contain-check an IP) so a 30-line DIY beats fighting jest.
 *
 * IPv6 isn't supported — the platform admin SPA is reachable only over IPv4
 * for now; revisit if we add Cloudflare front + IPv6 ingress.
 */
export class Ipv4Cidr {
  private readonly base: number;
  private readonly mask: number;

  constructor(cidr: string) {
    const slashIdx = cidr.indexOf('/');
    const ipPart = slashIdx === -1 ? cidr : cidr.slice(0, slashIdx);
    const prefixLen = slashIdx === -1 ? 32 : Number(cidr.slice(slashIdx + 1));
    if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 32) {
      throw new Error(`Invalid CIDR prefix length: ${cidr}`);
    }
    this.mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
    this.base = ipv4ToInt(ipPart) & this.mask;
  }

  contains(ip: string): boolean {
    try {
      return (ipv4ToInt(ip) & this.mask) === this.base;
    } catch {
      return false;
    }
  }
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) throw new Error(`Invalid IPv4 address: ${ip}`);
  let acc = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new Error(`Invalid IPv4 octet in ${ip}`);
    }
    acc = ((acc << 8) | n) >>> 0;
  }
  return acc;
}
