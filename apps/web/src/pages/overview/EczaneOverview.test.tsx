import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

type Q = { data: unknown; isLoading: boolean; error: null };
const q = (data: unknown): Q => ({ data, isLoading: false, error: null });

let rxData: {
  id: string;
  patient: { firstName: string; lastName: string; mrn: string | null } | null;
}[] = [];
let salesData: { id: string; soldAt: string; totalAmount: string; currency: string }[] = [];
let returnsData: { id: string }[] = [];
let cashData: { status: string } | null = null;

vi.mock('../../lib/trpc', () => ({
  trpc: {
    pharmacyRetail: {
      dispensablePrescriptions: { useQuery: () => q(rxData) },
      listSales: { useQuery: () => q(salesData) },
      listReturns: { useQuery: () => q(returnsData) },
      currentCash: { useQuery: () => q(cashData) },
    },
  },
}));

import { EczaneOverview } from './EczaneOverview';

const todayIso = new Date().toISOString();

function setup() {
  return render(
    <MemoryRouter>
      <EczaneOverview />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rxData = [];
  salesData = [];
  returnsData = [];
  cashData = null;
});

describe('EczaneOverview', () => {
  it('POS perakende KPI etiketlerini gösterir', () => {
    setup();
    expect(screen.getByText('overview.eczane.kpiRx')).toBeInTheDocument();
    expect(screen.getByText('overview.eczane.kpiSales')).toBeInTheDocument();
    expect(screen.getByText('overview.eczane.kpiTurnover')).toBeInTheDocument();
  });

  it("bugün POS satış sayısını listSales'ten (bugün filtreli) alır", () => {
    salesData = [
      { id: 's1', soldAt: todayIso, totalAmount: '50', currency: 'TJS' },
      { id: 's2', soldAt: todayIso, totalAmount: '30', currency: 'TJS' },
      { id: 'old', soldAt: '2020-01-01T10:00:00Z', totalAmount: '99', currency: 'TJS' },
    ];
    setup();
    expect(screen.getByText('2')).toBeInTheDocument(); // bugün 2 satış (eski hariç)
  });

  it('KVKK: reçete satırında hasta adı GÖSTERİLMEZ, yalnız MRN', () => {
    rxData = [{ id: 'r1', patient: { firstName: 'Mahrem', lastName: 'Hasta', mrn: 'TD26700042' } }];
    setup();
    expect(screen.queryByText('Mahrem Hasta')).not.toBeInTheDocument();
    expect(screen.getByText('TD26700042')).toBeInTheDocument();
  });
});
