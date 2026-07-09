import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { NurseSidebar } from './nurse-sidebar';

// v0.4 İP-8 (#544) — Hemşire mod menüleri. i18n passthrough (t = key).

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    auth: { me: { useQuery: () => ({ data: { name: 'Hş. Test' } }) } },
    nurseSession: { my: { useQuery: () => ({ data: undefined }) } },
    encounter: { myWorklist: { useQuery: () => ({ data: [] }) } },
    measurementOrder: { listForUnit: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock('../../../hooks/useClinic', () => ({
  useClinic: () => ({ name: 'Test Klinik', logoUrl: null }),
}));

let mockUser: { id: string; roles: string[]; mode?: string } = { id: 'u1', roles: ['hemsire'] };
vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}));

function renderSidebar(mode?: string) {
  mockUser = { id: 'u1', roles: ['hemsire'], mode };
  return render(
    <MemoryRouter>
      <NurseSidebar />
    </MemoryRouter>,
  );
}

describe('NurseSidebar — mod menüleri', () => {
  it('Genel mod: klinik-geneli menü (ölçüm + muayene sırası + ameliyat günü + hastalar)', () => {
    renderSidebar('genel');
    expect(screen.getByText('nav.measurementRequests')).toBeInTheDocument();
    expect(screen.getByText('nav.examQueue')).toBeInTheDocument();
    expect(screen.getByText('nav.surgeryDay')).toBeInTheDocument();
    expect(screen.getByText('nav.patients')).toBeInTheDocument();
    // Asistan'a özgü öğeler yok
    expect(screen.queryByText('nav.schedule')).not.toBeInTheDocument();
    expect(screen.queryByText('nav.dashboard')).not.toBeInTheDocument();
    expect(screen.getByText('roles.hemsire · roles.modeGenel')).toBeInTheDocument();
  });

  it('Asistan mod: Dr. adına menü (muayene sırası + randevular + hastalarım)', () => {
    renderSidebar('asistan');
    expect(screen.getByText('nav.examQueue')).toBeInTheDocument();
    expect(screen.getByText('nav.schedule')).toBeInTheDocument();
    expect(screen.getByText('nav.myPatients')).toBeInTheDocument();
    // Genel'e özgü klinik-geneli öğeler yok
    expect(screen.queryByText('nav.measurementRequests')).not.toBeInTheDocument();
    expect(screen.queryByText('nav.surgeryDay')).not.toBeInTheDocument();
    expect(screen.getByText('roles.hemsire · roles.modeAsistan')).toBeInTheDocument();
  });

  it('Klasik (mod yok): muayene sırası + hastalarım + sade rol etiketi (geri-uyum)', () => {
    renderSidebar(undefined);
    // #778 — jenerik "Gösterge paneli" kaldırıldı; özet = pinned-top Genel Bakış.
    expect(screen.queryByText('nav.dashboard')).not.toBeInTheDocument();
    expect(screen.getByText('nav.examQueue')).toBeInTheDocument();
    expect(screen.getByText('nav.myPatients')).toBeInTheDocument();
    expect(screen.getByText('roles.hemsire')).toBeInTheDocument();
    expect(screen.queryByText('roles.hemsire · roles.modeGenel')).not.toBeInTheDocument();
  });
});
