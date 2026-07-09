import { describe, expect, it } from 'vitest';
import { APP_VERSION, APP_VERSION_LABEL } from './version';

// __APP_VERSION__ Vite/Vitest `define`'ından gelir (package.json). Numara
// statik string değil — bump sonrası UI otomatik takip eder.
describe('version', () => {
  it('package.json sürümünden gelir (semver, boş değil)', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('etiket "v" önekiyle sürümü sarar', () => {
    expect(APP_VERSION_LABEL).toBe(`v${APP_VERSION}`);
  });
});
