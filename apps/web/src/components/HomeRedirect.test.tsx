import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HomeRedirect } from './HomeRedirect';

// v0.4 İP-27 (#563) — giriş mod akışı + rol açılış sayfası omurgası: HomeRedirect
// moda (rolden önce) ve sadece-rol durumuna göre doğru landing'e yönlendirir.

let mockUser: { roles: string[]; mode?: string } | null = null;
vi.mock('../providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}));

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

function landingFor(user: { roles: string[]; mode?: string } | null): string {
  mockUser = user;
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByTestId('loc').textContent ?? '';
}

describe('HomeRedirect — mod landing (rolden önce)', () => {
  it('olcum kilitli mod → /measurement-queue', () => {
    expect(landingFor({ roles: ['hemsire', 'olcum_hemsiresi'], mode: 'olcum' })).toBe(
      '/measurement-queue',
    );
  });
  it('genel mod → /measurement-queue (klinik-geneli hemşire görevleri)', () => {
    expect(landingFor({ roles: ['hemsire'], mode: 'genel' })).toBe('/measurement-queue');
  });
  it('asistan mod → /worklist (asiste edilen doktorun kuyruğu)', () => {
    expect(landingFor({ roles: ['hemsire'], mode: 'asistan' })).toBe('/worklist');
  });
});

describe('HomeRedirect — sadece-rol landing', () => {
  const cases: [string, string][] = [
    ['doktor', '/worklist'],
    ['resepsiyon', '/reception-queue'],
    ['olcum_hemsiresi', '/measurement-queue'],
    ['ameliyat_satis', '/surgery-sales'],
    ['hemsire', '/worklist'],
    ['eczane', '/pharmacy/pos'],
    ['finans', '/billing'],
    ['stok_satinalma', '/inventory/iol'],
  ];
  for (const [role, landing] of cases) {
    it(`sadece ${role} → ${landing}`, () => {
      expect(landingFor({ roles: [role] })).toBe(landing);
    });
  }

  // #726 — solo-yönetici kanonik "Genel Bakış" /overview'e gider (sidebar
  // pinned-top ile eşleşir). Eskiden /dashboard'a düşüyordu.
  it('sadece yönetici → /overview', () => {
    expect(landingFor({ roles: ['yonetici'] })).toBe('/overview');
  });
  // #908 — çoklu-rol (mixed) artık /overview'e gider (eski jenerik /dashboard
  // panosu emekli); OverviewPage taşınan rollerden en öncelikliyi çözer. Solo-
  // yönetici de /overview → AdminOverviewPage (ayrı /admin/overview #905'te kaldırıldı).
  it('yönetici + doktor (karma) → /overview', () => {
    expect(landingFor({ roles: ['yonetici', 'doktor'] })).toBe('/overview');
  });
  it('çoklu-rol (doktor+resepsiyon) → /overview', () => {
    expect(landingFor({ roles: ['doktor', 'resepsiyon'] })).toBe('/overview');
  });
});
