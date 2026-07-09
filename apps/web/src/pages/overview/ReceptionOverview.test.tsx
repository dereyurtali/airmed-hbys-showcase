import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

type Q = { data: unknown; isLoading: boolean; error: null };
const q = (data: unknown): Q => ({ data, isLoading: false, error: null });

let apptData: {
  id: string;
  status: string;
  startsAt: string;
  patient: { firstName: string; lastName: string; mrn: string };
}[] = [];
let queueData: {
  id: string;
  stage: string;
  patient: { firstName: string; lastName: string; mrn: string; tags?: string[] };
}[] = [];
let recallData: { id: string; patient: { firstName: string; lastName: string; mrn: string } }[] =
  [];
let complianceData: {
  activeUnpaidEncounters: unknown[];
  bypassActiveCount: number;
  bypassTotalToday: number;
};

vi.mock('../../lib/trpc', () => ({
  trpc: {
    appointment: { findInRange: { useQuery: () => q(apptData) } },
    encounter: { receptionQueue: { useQuery: () => q(queueData) } },
    recall: { list: { useQuery: () => q(recallData) } },
  },
}));
vi.mock('../../lib/billing.trpc', () => ({
  billingApi: { compliancePulse: { useQuery: () => q(complianceData) } },
}));
// SystemStatusStrip (useSyncStatus + useAuth) ayrı test ediliyor — burada stub.
vi.mock('../../components/overview/SystemStatusStrip', () => ({
  SystemStatusStrip: () => null,
}));

import { ReceptionOverview } from './ReceptionOverview';

function setup() {
  return render(
    <MemoryRouter>
      <ReceptionOverview />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apptData = [];
  queueData = [];
  recallData = [];
  complianceData = { activeUnpaidEncounters: [], bypassActiveCount: 0, bypassTotalToday: 0 };
});

describe('ReceptionOverview', () => {
  it('triage KPI etiketlerini gösterir', () => {
    setup();
    expect(screen.getByText('overview.reception.kpiAppointments')).toBeInTheDocument();
    expect(screen.getByText('overview.reception.kpiQueue')).toBeInTheDocument();
    expect(screen.getByText('overview.reception.kpiUnpaid')).toBeInTheDocument();
  });

  it('karşılama kuyruğu sayısını gerçek veriden gösterir', () => {
    queueData = [
      { id: '1', stage: 'waiting_doctor', patient: { firstName: 'A', lastName: 'B', mrn: 'M1' } },
      { id: '2', stage: 'in_measurement', patient: { firstName: 'C', lastName: 'D', mrn: 'M2' } },
    ];
    setup();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it("önce-öde ihlali (ödeme bekleyen) sayısını compliancePulse'tan alır", () => {
    complianceData = {
      activeUnpaidEncounters: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }],
      bypassActiveCount: 0,
      bypassTotalToday: 0,
    };
    setup();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
