import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { ReceptionSidebar } from './reception-sidebar';

// #778 — resepsiyon sidebar'ında jenerik "Gösterge paneli" (/dashboard)
// kaldırıldı; özet/ana-sayfa = pinned-top "Genel Bakış" (/overview).
// i18n passthrough (t = key) → assertion key üzerinden.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    auth: { me: { useQuery: () => ({ data: { name: 'Resepsiyon Test' } }) } },
    encounter: { receptionQueue: { useQuery: () => ({ data: [] }) } },
    metric: { today: { useQuery: () => ({ data: { appointments: { total: 0 } } }) } },
  },
}));

vi.mock('../../../hooks/useClinic', () => ({
  useClinic: () => ({ name: 'Test Klinik', logoUrl: null }),
}));

vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', roles: ['resepsiyon'] } }),
}));

function renderSidebar() {
  return render(
    <MemoryRouter>
      <ReceptionSidebar />
    </MemoryRouter>,
  );
}

describe('ReceptionSidebar (#778 çift-özet temizliği)', () => {
  it('Ön Büro + Hasta + Tahsilat + Geri-Çağırma öğeleri görünür', () => {
    renderSidebar();
    expect(screen.getByText('nav.receptionWelcome')).toBeInTheDocument();
    expect(screen.getByText('nav.appointments')).toBeInTheDocument();
    expect(screen.getByText('nav.patientRecords')).toBeInTheDocument();
    expect(screen.getByText('nav.billing')).toBeInTheDocument();
    expect(screen.getByText('nav.recall')).toBeInTheDocument();
  });

  it('jenerik "Gösterge paneli" (/dashboard) menüde YOK', () => {
    renderSidebar();
    expect(screen.queryByText('nav.dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('nav.group.general')).not.toBeInTheDocument();
  });
});
