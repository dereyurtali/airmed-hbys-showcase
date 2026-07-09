import { assertPublicWebhookUrl } from './ssrf-guard';

// #937 — Webhook SSRF guard. IP-literal URL'lerle test (dns.lookup IP literal'i
// ağ sorgusu olmadan çözer → deterministik, network gerektirmez).
describe('assertPublicWebhookUrl (#937 SSRF)', () => {
  it('loopback/private/link-local IP reddedilir', async () => {
    await expect(assertPublicWebhookUrl('https://127.0.0.1/hook')).rejects.toThrow(/SSRF|private/i);
    await expect(assertPublicWebhookUrl('https://10.1.2.3/hook')).rejects.toThrow(/SSRF|private/i);
    await expect(assertPublicWebhookUrl('https://192.168.1.10/hook')).rejects.toThrow(
      /SSRF|private/i,
    );
    await expect(assertPublicWebhookUrl('https://172.16.5.5/hook')).rejects.toThrow(
      /SSRF|private/i,
    );
    // cloud metadata endpoint (link-local)
    await expect(assertPublicWebhookUrl('https://169.254.169.254/latest')).rejects.toThrow(
      /SSRF|private/i,
    );
  });

  it('IPv6 loopback + IPv4-mapped private reddedilir', async () => {
    await expect(assertPublicWebhookUrl('https://[::1]/hook')).rejects.toThrow(/SSRF|private/i);
  });

  it('non-https reddedilir', async () => {
    await expect(assertPublicWebhookUrl('http://8.8.8.8/hook')).rejects.toThrow(/https/i);
  });

  it('public IP geçer', async () => {
    await expect(assertPublicWebhookUrl('https://8.8.8.8/hook')).resolves.toBeUndefined();
  });
});
