import { describe, it, expect } from 'vitest';
import { NAV_GROUPS } from './AdminShell';
import { TOP_LEVEL_ROUTES } from './AdminBackBar';

// #1094 — Geri-buton drift guard (apps/web sidebar-top-level.sync.test.ts ikizi):
// sidebar'dan (NAV_GROUPS) DİREKT ulaşılan her ekran TOP_LEVEL_ROUTES'ta olmalı
// → o ekranda geri butonu render EDİLMEZ (CLAUDE.md 2026-07-04 geri-buton kuralı).
// Yeni İZLEME/GÜVENLİK ekranı ekleyip seti güncellemeyen dev bu testi kırmızı görür.

describe('AdminBackBar top-level ↔ sidebar senkron (#1094)', () => {
  const navRoutes = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to));

  it('sidebar’daki her top-level route TOP_LEVEL_ROUTES setinde', () => {
    const missing = navRoutes.filter((r) => !TOP_LEVEL_ROUTES.has(r));
    expect(
      missing,
      `sidebar route’ları TOP_LEVEL_ROUTES’a eklenmeli: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('TOP_LEVEL_ROUTES kök “/” dışında yalnız gerçek sidebar route’ları içerir', () => {
    // '/' HomeRedirect; kalan tüm set üyeleri sidebar’da bir nav item olmalı
    // (ölü/eskimiş route birikmesini engeller).
    const nav = new Set(navRoutes);
    const stale = [...TOP_LEVEL_ROUTES].filter((r) => r !== '/' && !nav.has(r));
    expect(stale, `TOP_LEVEL_ROUTES’ta sidebar’da olmayan route: ${stale.join(', ')}`).toEqual([]);
  });
});
