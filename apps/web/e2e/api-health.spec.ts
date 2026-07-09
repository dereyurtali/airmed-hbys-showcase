import { test, expect } from '@playwright/test';

// Backend /api/health smoke — Playwright webServer config api'yi de boot
// ediyor; sayfa açmadan request seviyesi healthy mi diye doğrularız.
test.describe('api health endpoint (network smoke)', () => {
  test('GET /api/health → 200 + status ok', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { status: string; service: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('airmed-hbys-api');
  });
});
