import { describe, it, expect } from 'vitest';
import { scrubText, routePattern, sourcePath } from './redact';

describe('scrubText', () => {
  it('e-posta maskeler', () => {
    expect(scrubText('mail hasta@klinik.tj geldi')).toBe('mail [e-posta] geldi');
  });

  it('MRN maskeler (harf+rakam)', () => {
    expect(scrubText('kayıt TD26700042 bulundu')).toBe('kayıt [mrn] bulundu');
  });

  it('TCKN (11 hane) maskeler', () => {
    expect(scrubText('kimlik 12345678901 no')).toBe('kimlik [kimlik] no');
  });

  it('ayraçlı telefon maskeler', () => {
    expect(scrubText('tel +992 90 123 45 67 ara')).toBe('tel [telefon] ara');
  });

  it('uzun rakam dizisi (7+) maskeler', () => {
    expect(scrubText('hesap 992123456789 ile')).toBe('hesap [numara] ile');
  });

  it('Geri-Bildirim token uyumu: [e-posta] + [numara]', () => {
    // feedback.scrub testi bu iki token'a bağımlı.
    const out = scrubText('Hasta foto@klinik.tj 992123456789 ile cokuyor');
    expect(out).not.toContain('foto@klinik.tj');
    expect(out).toContain('[e-posta]');
    expect(out).toContain('[numara]');
  });

  it('PII içermeyen metni değiştirmez', () => {
    expect(scrubText('worklist donuyor')).toBe('worklist donuyor');
  });
});

describe('routePattern', () => {
  it('sayısal segment → :id', () => {
    expect(routePattern('/exams/55')).toBe('/exams/:id');
  });

  it('MRN segment → :id', () => {
    expect(routePattern('/patients/TD26700042/exams/55')).toBe('/patients/:id/exams/:id');
  });

  it('UUID segment → :id', () => {
    expect(routePattern('/users/3f2504e0-4f89-41d3-9a0c-0305e82c3301/edit')).toBe(
      '/users/:id/edit',
    );
  });

  it('query string atılır', () => {
    expect(routePattern('/patients/55?q=secret')).toBe('/patients/:id');
  });

  it('mutlak URL: origin korunur, path normalize', () => {
    expect(routePattern('https://app.example.com/patients/55')).toBe(
      'https://app.example.com/patients/:id',
    );
  });

  it('statik path değişmez', () => {
    expect(routePattern('/worklist')).toBe('/worklist');
  });
});

describe('sourcePath', () => {
  it('mutlak dev yolu → proje-göreli (kullanıcı dizini sızmaz)', () => {
    expect(sourcePath('/Users/alid/DNA-Projects/airmed-hbys/apps/api/src/x.ts')).toBe(
      'apps/api/src/x.ts',
    );
  });

  it('node_modules yolu işaretten kesilir', () => {
    expect(sourcePath('/home/runner/work/airmed/node_modules/@sentry/node/index.js')).toBe(
      'node_modules/@sentry/node/index.js',
    );
  });

  it('file:// + query temizlenir', () => {
    expect(sourcePath('file:///app/src/main.tsx?v=123')).toBe('src/main.tsx');
  });

  it('işaretsiz mutlak yol → yalnız dosya adı', () => {
    expect(sourcePath('/opt/weird/path/thing.js')).toBe('thing.js');
  });

  it('göreli yol olduğu gibi', () => {
    expect(sourcePath('apps/web/src/App.tsx')).toBe('apps/web/src/App.tsx');
  });
});
