import { maskErrorMessage } from './trpc';

// #919 — tRPC internal hata mesajı sızıntısı: prod'da INTERNAL_SERVER_ERROR
// mesajı generic'e iner, bilinen 4xx/i18n mesajları korunur.
describe('maskErrorMessage (#919)', () => {
  it('prod + INTERNAL_SERVER_ERROR → generic mesaj', () => {
    expect(
      maskErrorMessage(
        'INTERNAL_SERVER_ERROR',
        'Unique constraint failed on the fields: (`users_email_key`)',
        true,
      ),
    ).toBe('Internal server error');
  });

  it('prod + bilinçli 4xx (CONFLICT) → orijinal korunur', () => {
    expect(maskErrorMessage('CONFLICT', 'E-posta zaten kayıtlı', true)).toBe(
      'E-posta zaten kayıtlı',
    );
  });

  it('prod + BAD_REQUEST → orijinal korunur', () => {
    expect(maskErrorMessage('BAD_REQUEST', 'validation failed', true)).toBe('validation failed');
  });

  it('dev + INTERNAL_SERVER_ERROR → orijinal (debug için) korunur', () => {
    expect(maskErrorMessage('INTERNAL_SERVER_ERROR', 'boom at users.service:42', false)).toBe(
      'boom at users.service:42',
    );
  });
});
