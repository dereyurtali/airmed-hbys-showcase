import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

type Q = { data: unknown; isLoading: boolean; error: null };
const q = (data: unknown): Q => ({ data, isLoading: false, error: null });

type StockRow = {
  name: string | null;
  code: string;
  available: number;
  minQty: number;
  unit: string;
  low: boolean;
};
let approvalsData: { items: { id: string; reason: string; discountPercent: string }[] };
let stockData: { lenses: StockRow[]; supplies: StockRow[]; drugs: StockRow[]; clinicName: string };
let complianceData: {
  activeUnpaidEncounters: unknown[];
  bypassActiveCount: number;
  bypassTotalToday: number;
};

const escalateMutate = vi.fn();
vi.mock('../../lib/trpc', () => ({
  trpc: {
    dashboard: {
      pendingApprovals: { useQuery: () => q(approvalsData) },
      stockOverview: { useQuery: () => q(stockData) },
    },
    approval: {
      escalate: { useMutation: () => ({ mutate: escalateMutate, isPending: false }) },
    },
  },
}));
vi.mock('../../lib/billing.trpc', () => ({
  billingApi: { compliancePulse: { useQuery: () => q(complianceData) } },
}));

import { AssistantOverview } from './AssistantOverview';

function srow(code: string, low: boolean): StockRow {
  return { name: code, code, available: low ? 1 : 50, minQty: 10, unit: 'ad', low };
}
function setup() {
  return render(
    <MemoryRouter>
      <AssistantOverview />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  approvalsData = { items: [] };
  stockData = { lenses: [], supplies: [], drugs: [], clinicName: 'X' };
  complianceData = { activeUnpaidEncounters: [], bypassActiveCount: 0, bypassTotalToday: 0 };
  escalateMutate.mockClear();
});

describe('AssistantOverview', () => {
  it('operate-but-not-finalize: primary "Bekleyenleri İncele" (onayla değil)', () => {
    setup();
    expect(screen.getByText('overview.asistan.reviewPending')).toBeInTheDocument();
    expect(screen.getByText('overview.asistan.widgetEscalate')).toBeInTheDocument();
  });

  it('bekleyen onay sayısını gösterir', () => {
    approvalsData = {
      items: [
        { id: 'a1', reason: 'r1', discountPercent: '15' },
        { id: 'a2', reason: 'r2', discountPercent: '20' },
      ],
    };
    setup();
    expect(screen.getByText('overview.asistan.kpiApprovals')).toBeInTheDocument();
    expect(screen.getByText('r1')).toBeInTheDocument();
  });

  it('R5: "Eskale et" butonu onayı yöneticiye iletir (mutate çağrılır)', () => {
    approvalsData = { items: [{ id: 'a1', reason: 'r1', discountPercent: '15' }] };
    setup();
    fireEvent.click(screen.getByTestId('escalate-a1'));
    expect(escalateMutate).toHaveBeenCalledWith({ id: 'a1' });
  });

  it("kritik stok sayısını low-flag'ten türetir", () => {
    stockData = {
      lenses: [srow('L1', true)],
      supplies: [srow('S1', true), srow('S2', false)],
      drugs: [],
      clinicName: 'X',
    };
    setup();
    expect(screen.getByText('overview.asistan.kpiStock')).toBeInTheDocument();
    expect(screen.getByText('L1')).toBeInTheDocument();
  });
});
