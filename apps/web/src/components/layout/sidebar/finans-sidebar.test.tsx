import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { FinansSidebar } from './finans-sidebar';

// v0.4 İP-9 (#545) — Finans Yetkilisi markalı sidebar. i18n passthrough (t = key).

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    auth: { me: { useQuery: () => ({ data: { name: 'Finans Test' } }) } },
    approval: { countPending: { useQuery: () => ({ data: { count: 0 } }) } },
  },
}));

vi.mock('../../../hooks/useClinic', () => ({
  useClinic: () => ({ name: 'Test Klinik', logoUrl: null }),
}));

vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'finans@test.io', roles: ['finans'] } }),
}));

describe('FinansSidebar — finans menüsü', () => {
  it('para ekranlarını gösterir (tahsilat/kasa/onay/hakediş/fraud/rapor)', () => {
    render(
      <MemoryRouter>
        <FinansSidebar />
      </MemoryRouter>,
    );
    for (const label of [
      'nav.billing',
      'nav.cashRegister',
      'nav.approvals',
      'nav.commission',
      'nav.fraud',
      'nav.reports',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('PO onayı için ayrı öğe YOK — tek kanonik giriş /approvals (#904)', () => {
    render(
      <MemoryRouter>
        <FinansSidebar />
      </MemoryRouter>,
    );
    expect(screen.queryByText('nav.purchaseOrderApprovals')).not.toBeInTheDocument();
  });

  it('rol etiketi Finans Yetkilisi; klinik/hasta öğeleri yok', () => {
    render(
      <MemoryRouter>
        <FinansSidebar />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('roles.finans').length).toBeGreaterThan(0);
    expect(screen.queryByText('nav.patients')).not.toBeInTheDocument();
    expect(screen.queryByText('nav.worklist')).not.toBeInTheDocument();
  });
});
