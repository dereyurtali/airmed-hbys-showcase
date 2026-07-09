import { describe, it, expect } from 'vitest';
import { resolveGuideScreenKey, guideVariantKey } from './guide-resolver';
import guideTr from '../i18n/locales/guide.tr.json';

// #1072 — Kılavuz altyapısı: resolver route→screenKey + variant→guideKey +
// içerik kapsam iskeleti (sidebar-top-level.sync.test.ts deseni).

describe('resolveGuideScreenKey', () => {
  it('statik rota → screenKey', () => {
    expect(resolveGuideScreenKey('/patients')).toBe('patients');
    expect(resolveGuideScreenKey('/schedule')).toBe('schedule');
    expect(resolveGuideScreenKey('/billing')).toBe('billing');
  });

  it('dinamik rota → screenKey (spesifik önce)', () => {
    expect(resolveGuideScreenKey('/patients/new')).toBe('patientForm');
    expect(resolveGuideScreenKey('/patients/abc-123')).toBe('patientDetail');
    expect(resolveGuideScreenKey('/billing/xyz-9')).toBe('invoiceDetail');
    expect(resolveGuideScreenKey('/admin/users/u-1')).toBe('userDetail');
  });

  it('bilinmeyen rota → null', () => {
    expect(resolveGuideScreenKey('/nonexistent-route')).toBeNull();
  });
});

describe('guideVariantKey', () => {
  it('full varyantı default içeriğe düşer (ayrı metin yazılmaz)', () => {
    expect(guideVariantKey('full')).toBe('default');
  });
  it('measurement-nurse → measurement', () => {
    expect(guideVariantKey('measurement-nurse')).toBe('measurement');
  });
  it('rol varyantları kendi anahtarına eşlenir', () => {
    expect(guideVariantKey('doctor')).toBe('doctor');
    expect(guideVariantKey('reception')).toBe('reception');
  });
});

describe('guide içerik kapsam iskeleti', () => {
  // Altyapı fazında yalnız `default` içeriği seed'lidir; varyant içerikleri
  // #1073-1080'de dolar. Bu test default fallback'in var olduğunu ve şeklinin
  // doğru olduğunu kilitler (içerik issue'ları eklendikçe genişletilir).
  it('default içeriğindeki her ekran title + tasks içerir', () => {
    const def = (guideTr as { default: Record<string, { title?: string; tasks?: unknown[] }> })
      .default;
    expect(Object.keys(def).length).toBeGreaterThan(0);
    for (const [key, screen] of Object.entries(def)) {
      expect(screen.title, `default.${key}.title`).toBeTruthy();
      expect(Array.isArray(screen.tasks), `default.${key}.tasks`).toBe(true);
    }
  });

  it('meta anahtarları (sekme + etiketler + comingSoon) mevcut', () => {
    const meta = (guideTr as { meta: Record<string, string> }).meta;
    for (const k of [
      'comingSoon',
      'thisScreenTab',
      'firstDayTab',
      'purposeLabel',
      'layoutLabel',
      'tasksLabel',
    ]) {
      expect(meta[k], `meta.${k}`).toBeTruthy();
    }
  });
});
