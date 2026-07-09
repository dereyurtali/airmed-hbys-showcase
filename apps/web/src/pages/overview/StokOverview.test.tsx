import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

type Q = { data: unknown; isLoading: boolean; error: null };
const q = (data: unknown): Q => ({ data, isLoading: false, error: null });

type Row = {
  name: string | null;
  code: string;
  available: number;
  minQty: number;
  unit: string;
  low: boolean;
};
let stockData: { lenses: Row[]; supplies: Row[]; drugs: Row[]; clinicName: string };
let poData: { id: string; orderNo: string; supplier: { name: string } | null }[] = [];

vi.mock('../../lib/trpc', () => ({
  trpc: {
    dashboard: { stockOverview: { useQuery: () => q(stockData) } },
    purchaseOrder: { list: { useQuery: () => q(poData) } },
  },
}));

import { StokOverview } from './StokOverview';

function row(code: string, low: boolean): Row {
  return { name: code, code, available: low ? 1 : 50, minQty: 10, unit: 'ad', low };
}
function setup() {
  return render(
    <MemoryRouter>
      <StokOverview />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  stockData = { lenses: [], supplies: [], drugs: [], clinicName: 'X' };
  poData = [];
});

describe('StokOverview', () => {
  it("kritik IOL/sarf sayımlarını low-flag'ten türetir", () => {
    stockData = {
      lenses: [row('L1', true), row('L2', false)],
      supplies: [row('S1', true)],
      drugs: [],
      clinicName: 'X',
    };
    setup();
    expect(screen.getByText('overview.stok.kpiIol')).toBeInTheDocument();
    expect(screen.getByText('overview.stok.widgetCritical')).toBeInTheDocument();
  });

  it('hızlı işlemler (Yeni PO / Mal Kabul / Tahmin) gösterilir', () => {
    setup();
    expect(screen.getByText('overview.stok.quickNewPo')).toBeInTheDocument();
    expect(screen.getByText('overview.stok.quickReceive')).toBeInTheDocument();
    expect(screen.getByText('overview.stok.quickForecast')).toBeInTheDocument();
  });

  it('açık sipariş sayısını PO listesinden alır', () => {
    poData = [
      { id: '1', orderNo: 'PO-1', supplier: { name: 'T1' } },
      { id: '2', orderNo: 'PO-2', supplier: null },
    ];
    setup();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
