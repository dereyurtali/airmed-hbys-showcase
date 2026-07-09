import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { StokSidebar } from './stok-sidebar';

// v0.4 İP-10 (#546) — Stok & Satın Alma markalı sidebar. i18n passthrough (t = key).

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    auth: { me: { useQuery: () => ({ data: { name: 'Depo Test' } }) } },
  },
}));

vi.mock('../../../hooks/useClinic', () => ({
  useClinic: () => ({ name: 'Test Klinik', logoUrl: null }),
}));

vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'depo@test.io', roles: ['stok_satinalma'] } }),
}));

describe('StokSidebar — stok & satın alma menüsü', () => {
  it('depo/tedarik ekranlarını gösterir (IOL/yönetim/sarf/tedarikçiler/PO/tahmin)', () => {
    render(
      <MemoryRouter>
        <StokSidebar />
      </MemoryRouter>,
    );
    for (const label of [
      'nav.iolInventory',
      'nav.iolManage',
      'nav.consumables',
      'nav.suppliers',
      'nav.purchaseOrders',
      'nav.stockForecast',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('hasta/finans ekranları yok (modül-kısıtlı); PO onay kuyruğu yok (görev ayrılığı)', () => {
    render(
      <MemoryRouter>
        <StokSidebar />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('roles.stokSatinalma').length).toBeGreaterThan(0);
    expect(screen.queryByText('nav.billing')).not.toBeInTheDocument();
    expect(screen.queryByText('nav.patients')).not.toBeInTheDocument();
    expect(screen.queryByText('nav.purchaseOrderApprovals')).not.toBeInTheDocument();
  });
});
