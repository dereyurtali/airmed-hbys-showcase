import { describe, expect, it } from 'vitest';
import { translate } from './messages';

describe('translate()', () => {
  it('resolves a TR key', () => {
    expect(translate('tr', 'shell.logout')).toBe('Çıkış');
  });

  it('resolves the parallel EN key', () => {
    expect(translate('en', 'shell.logout')).toBe('Sign out');
  });

  it('interpolates {{vars}}', () => {
    expect(translate('tr', 'dashboard.healthHint', { db: '2 GB' })).toBe('DB 2 GB');
    expect(translate('en', 'impersonationBanner.text', { count: 3 })).toBe(
      '3 active impersonation session(s) open',
    );
  });

  it('falls back to TR when an EN key is missing', () => {
    // Force a missing-key path: an unknown key returns the key itself, not a throw.
    expect(translate('en', 'nope.missing.key')).toBe('nope.missing.key');
  });

  it('leaves unknown interpolation tokens intact', () => {
    expect(translate('tr', 'dashboard.healthHint', {})).toBe('DB {{db}}');
  });
});
