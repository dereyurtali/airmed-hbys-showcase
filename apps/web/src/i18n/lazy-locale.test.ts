import { describe, expect, it } from 'vitest';
import i18n, { initI18n } from './index';

// #1056 — dil-başına lazy locale yüklemesi: TR bundled, RU/TG backend'den.
describe('i18n lazy locale loading', () => {
  it('TR (bundled) init sonrası anında hazır', async () => {
    await initI18n();
    const v = i18n.t('actions.loading', { lng: 'tr' });
    expect(v).not.toBe('actions.loading');
  });

  it('changeLanguage(ru) backend chunk yükler ve RU kaynağını kullanır', async () => {
    await initI18n();
    await i18n.changeLanguage('ru');
    const v = i18n.t('actions.loading');
    const ruCommon = (await import('./resources.ru')).default.common as {
      actions: { loading: string };
    };
    expect(v).toBe(ruCommon.actions.loading);
    await i18n.changeLanguage('tr');
  });

  it('changeLanguage(tg) backend chunk yükler ve TG kaynağını kullanır', async () => {
    await initI18n();
    await i18n.changeLanguage('tg');
    const v = i18n.t('actions.loading');
    const tgCommon = (await import('./resources.tg')).default.common as {
      actions: { loading: string };
    };
    expect(v).toBe(tgCommon.actions.loading);
    await i18n.changeLanguage('tr');
  });
});
