import { HttpSmsProvider } from './http-sms.provider';

describe('HttpSmsProvider (#428)', () => {
  const provider = new HttpSmsProvider();
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.restoreAllMocks();
  });

  it('is dormant (FAILED, no network) when SMS_GATEWAY_URL unset', async () => {
    delete process.env.SMS_GATEWAY_URL;
    expect(HttpSmsProvider.isConfigured()).toBe(false);
    const fetchSpy = jest.spyOn(globalThis, 'fetch' as never);
    const res = await provider.send('+992900000000', {
      subject: null,
      body: 'Randevu yarın 10:00',
    });
    expect(res.status).toBe('FAILED');
    expect(res.error).toMatch(/not configured/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs to the gateway and returns SENT on 2xx', async () => {
    process.env.SMS_GATEWAY_URL = 'https://sms.example.tj/send';
    process.env.SMS_GATEWAY_KEY = 'secret';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'gw-123' }),
    });
    jest.spyOn(globalThis, 'fetch' as never).mockImplementation(fetchMock as never);

    const res = await provider.send('+992900000000', { subject: null, body: 'Ödeme önce alınır' });
    expect(res.status).toBe('SENT');
    expect(res.externalId).toBe('gw-123');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sms.example.tj/send');
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({
      to: '+992900000000',
      text: 'Ödeme önce alınır',
    });
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe(
      'Bearer secret',
    );
  });

  it('returns FAILED on non-2xx gateway response', async () => {
    process.env.SMS_GATEWAY_URL = 'https://sms.example.tj/send';
    jest.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'upstream down',
    } as never);
    const res = await provider.send('+992900000000', { subject: null, body: 'x' });
    expect(res.status).toBe('FAILED');
    expect(res.error).toMatch(/502/);
  });
});
