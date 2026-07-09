import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

type Q = { data: unknown; isLoading: boolean; error: null };
const q = (data: unknown): Q => ({ data, isLoading: false, error: null });

let approvalsData: {
  items: { id: string; reason: string; discountPercent: string; patientName: string }[];
};
let poData: {
  id: string;
  orderNo: string;
  supplier: { name: string } | null;
  totalAmount: string;
  currency: string;
}[] = [];
let complianceData: {
  activeUnpaidEncounters: unknown[];
  bypassActiveCount: number;
  bypassTotalToday: number;
};

vi.mock('../../lib/trpc', () => ({
  trpc: {
    dashboard: { pendingApprovals: { useQuery: () => q(approvalsData) } },
    purchaseOrder: { list: { useQuery: () => q(poData) } },
  },
}));
vi.mock('../../lib/billing.trpc', () => ({
  billingApi: { compliancePulse: { useQuery: () => q(complianceData) } },
}));

import { FinansOverview } from './FinansOverview';

function setup() {
  return render(
    <MemoryRouter>
      <FinansOverview />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  approvalsData = { items: [] };
  poData = [];
  complianceData = { activeUnpaidEncounters: [], bypassActiveCount: 0, bypassTotalToday: 0 };
});

describe('FinansOverview', () => {
  it('onay triage KPI etiketlerini gösterir', () => {
    setup();
    expect(screen.getByText('overview.finans.kpiDiscount')).toBeInTheDocument();
    expect(screen.getByText('overview.finans.kpiPo')).toBeInTheDocument();
    expect(screen.getByText('overview.finans.kpiUnpaid')).toBeInTheDocument();
  });

  it("pay-first ihlal sayısını compliancePulse'tan alır", () => {
    complianceData = {
      activeUnpaidEncounters: [{ id: 'e1' }, { id: 'e2' }],
      bypassActiveCount: 1,
      bypassTotalToday: 3,
    };
    setup();
    // '2' hem KPI kartında hem Uyum Nabzı widget'ında görünür → en az bir yerde.
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
  });

  it('MALİ İZOLASYON: indirim satırında hasta adı GÖSTERİLMEZ', () => {
    approvalsData = {
      items: [{ id: 'a1', reason: 'kampanya', discountPercent: '15', patientName: 'Mahrem Hasta' }],
    };
    setup();
    expect(screen.queryByText('Mahrem Hasta')).not.toBeInTheDocument();
    expect(screen.getByText('kampanya')).toBeInTheDocument();
  });
});
