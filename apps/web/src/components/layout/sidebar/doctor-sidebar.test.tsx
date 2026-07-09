import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { DoctorSidebar } from './doctor-sidebar';

// v0.4 İP-7 (#543) — Doktor niteliği (Yerleşik/Misafir) sidebar farkı. i18n
// passthrough (t = key) → etiketler key olarak render olur, assertion key üzerinden.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    doctor: {
      myProfile: {
        useQuery: () => ({ data: { id: 'd1', name: 'Dr. Test', specialty: 'Göz' } }),
      },
    },
    encounter: { myWorklist: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock('../../../hooks/useClinic', () => ({
  useClinic: () => ({ name: 'Test Klinik', logoUrl: null }),
}));

let mockUser: { id: string; email: string; roles: string[]; flags?: Record<string, unknown> } = {
  id: 'u1',
  email: 'doc@test.io',
  roles: ['doktor'],
};
vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}));

function renderSidebar(flags?: Record<string, unknown>) {
  mockUser = { id: 'u1', email: 'doc@test.io', roles: ['doktor'], flags };
  return render(
    <MemoryRouter>
      <DoctorSidebar />
    </MemoryRouter>,
  );
}

describe('DoctorSidebar — Yerleşik / Misafir niteliği (v0.4.1 gruplu menü)', () => {
  it('yerleşik doktor: Günlük Akış + Hastalar + Ameliyat (mockup; gösterge paneli yok)', () => {
    renderSidebar(undefined);
    expect(screen.getByText('nav.examQueue')).toBeInTheDocument();
    expect(screen.getByText('nav.myAppointments')).toBeInTheDocument();
    expect(screen.getByText('nav.cosign')).toBeInTheDocument();
    expect(screen.getByText('nav.myPatients')).toBeInTheDocument();
    expect(screen.getByText('nav.surgeryDay')).toBeInTheDocument();
    // Doktor landing'i /worklist; menüde Genel Bakış yok (mockup).
    expect(screen.queryByText('nav.dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('nav.todayList')).not.toBeInTheDocument();
  });

  it('misafir doktor: dar menü (Bugünkü Listem + Randevularım + Atanmış Hastalarım + Co-sign)', () => {
    renderSidebar({ is_visiting_doctor: true });
    expect(screen.getByText('nav.todayList')).toBeInTheDocument();
    expect(screen.getByText('nav.myAssignedPatients')).toBeInTheDocument();
    expect(screen.getByText('nav.cosign')).toBeInTheDocument();
    // Misafir kilit şeridi
    expect(screen.getByText('nav.visitingLock')).toBeInTheDocument();
  });

  it('misafir doktor: klinik-geneli öğeler gizli (gösterge paneli + muayene sırası + genel hasta listesi)', () => {
    renderSidebar({ is_visiting_doctor: true });
    expect(screen.queryByText('nav.dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('nav.examQueue')).not.toBeInTheDocument();
    expect(screen.queryByText('nav.myPatients')).not.toBeInTheDocument();
  });

  it('misafir doktor: rol etiketinde "Misafir" imzası', () => {
    renderSidebar({ is_visiting_doctor: true });
    expect(screen.getByText('roles.doktor · roles.visiting')).toBeInTheDocument();
  });

  it('yerleşik doktor: rol etiketi sade "Doktor"', () => {
    renderSidebar(undefined);
    expect(screen.getByText('roles.doktor')).toBeInTheDocument();
    expect(screen.queryByText('roles.doktor · roles.visiting')).not.toBeInTheDocument();
  });
});
