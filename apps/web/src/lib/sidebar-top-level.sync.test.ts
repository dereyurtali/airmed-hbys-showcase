import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isTopLevelRoute, type SidebarVariant } from './sidebar-variant';

// #1031 KURAL (Ali, 2026-07-03): sol menüden doğrudan ulaşılan hiçbir ekranda
// geri butonu görünmez — TÜM roller. BackBar bunu isTopLevelRoute ile sağlar;
// bu test her <variant>-sidebar.tsx'teki `to:` rotasının o varyantın top-level
// listesinde olduğunu ZORLAR. Sidebar'a link ekleyip listeyi unutursan bu test
// kırmızı yanar (2026-07-03'te admin listesi 5/11 rotaya sapmıştı — bu sınıf
// bug'ın kalıcı kilidi).

const SIDEBAR_DIR = join(dirname(fileURLToPath(import.meta.url)), '../components/layout/sidebar');

const FILE_TO_VARIANT: Record<string, SidebarVariant> = {
  'admin-sidebar.tsx': 'admin',
  'doctor-sidebar.tsx': 'doctor',
  'finans-sidebar.tsx': 'finans',
  'full-sidebar.tsx': 'full',
  'measurement-nurse-sidebar.tsx': 'measurement-nurse',
  'nurse-sidebar.tsx': 'nurse',
  'pharmacy-sidebar.tsx': 'pharmacy',
  'reception-sidebar.tsx': 'reception',
  'sales-sidebar.tsx': 'sales',
  'stok-sidebar.tsx': 'stok',
};

function extractRoutes(file: string): string[] {
  const source = readFileSync(join(SIDEBAR_DIR, file), 'utf8');
  return [...source.matchAll(/to: '(\/[^']*)'/g)].map((m) => m[1]);
}

describe('sidebar ↔ top-level route senkronu (#1031)', () => {
  it('her sidebar varyant dosyası eşlemede kayıtlı (yeni varyant eklerken güncelle)', () => {
    const files = readdirSync(SIDEBAR_DIR).filter(
      (f) => f.endsWith('-sidebar.tsx') && !f.endsWith('.test.tsx'),
    );
    expect(files.sort()).toEqual(Object.keys(FILE_TO_VARIANT).sort());
  });

  for (const [file, variant] of Object.entries(FILE_TO_VARIANT)) {
    it(`${variant}: sidebar'daki her rota top-level (BackBar gizli)`, () => {
      const routes = extractRoutes(file);
      expect(routes.length).toBeGreaterThan(0);
      const missing = routes.filter((r) => !isTopLevelRoute(r, variant));
      expect(missing).toEqual([]);
    });
  }
});
