import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

let mockMode: string | undefined;
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u', roles: ['hemsire'], mode: mockMode } }),
}));

type Q = { data: unknown; isLoading: boolean; error: null };
const q = (data: unknown): Q => ({ data, isLoading: false, error: null });

let measData: {
  id: string;
  patient: { firstName: string; lastName: string; mrn: string };
  requiresPayment: boolean;
}[] = [];
let recallData: { id: string; patient: { firstName: string; lastName: string; mrn: string } }[] =
  [];
let surgeryData: {
  items: {
    id: string;
    safetyFullyComplete: boolean;
    patient: { firstName: string; lastName: string };
  }[];
};
let sessionData: { doctorUserId: string } | null = null;
let doctorsData: { items: { userId: string; name: string }[] };
let worklistData: { id: string; patient: { firstName: string; lastName: string; mrn: string } }[] =
  [];

vi.mock('../../lib/trpc', () => ({
  trpc: {
    measurementOrder: { listForUnit: { useQuery: () => q(measData) } },
    // #1066 — recall+surgery artık tek agregat sorguda (dashboard.nurseOverview).
    dashboard: {
      nurseOverview: {
        useQuery: () => q({ recallMissed: recallData, recallToday: [], surgeries: surgeryData }),
      },
    },
    nurseSession: { my: { useQuery: () => q(sessionData) } },
    doctor: { list: { useQuery: () => q(doctorsData) } },
    encounter: { myWorklist: { useQuery: () => q(worklistData) } },
  },
}));

import { NurseOverview } from './NurseOverview';

function setup() {
  return render(
    <MemoryRouter>
      <NurseOverview />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockMode = 'genel';
  measData = [];
  recallData = [];
  surgeryData = { items: [] };
  sessionData = null;
  doctorsData = { items: [] };
  worklistData = [];
});

describe('NurseOverview', () => {
  it('genel mod → ölçüm bekleyen KPI + sayım', () => {
    measData = [
      { id: 'o1', patient: { firstName: 'A', lastName: 'B', mrn: 'M1' }, requiresPayment: false },
      { id: 'o2', patient: { firstName: 'C', lastName: 'D', mrn: 'M2' }, requiresPayment: true },
    ];
    setup();
    expect(screen.getByText('overview.nurse.kpiMeasPending')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('genel mod → güvenlik kontrol eksik sayısı', () => {
    surgeryData = {
      items: [
        { id: 's1', safetyFullyComplete: false, patient: { firstName: 'P', lastName: 'Q' } },
        { id: 's2', safetyFullyComplete: true, patient: { firstName: 'R', lastName: 'S' } },
      ],
    };
    setup();
    expect(screen.getByText('overview.nurse.kpiSafety')).toBeInTheDocument();
  });

  it('asistan mod → "Dr. X adına" acting banner', () => {
    mockMode = 'asistan';
    sessionData = { doctorUserId: 'd1' };
    doctorsData = { items: [{ userId: 'd1', name: 'Dr. X' }] };
    setup();
    expect(screen.getByTestId('nurse-acting-banner')).toHaveTextContent('Dr. X');
    expect(screen.getByText('overview.nurse.kpiMyQueue')).toBeInTheDocument();
  });

  it("asistan mod → genel ölçüm/recall widget'ları yok (doktor-scope)", () => {
    mockMode = 'asistan';
    sessionData = { doctorUserId: 'd1' };
    doctorsData = { items: [{ userId: 'd1', name: 'Dr. X' }] };
    setup();
    expect(screen.queryByText('overview.nurse.widgetRecall')).not.toBeInTheDocument();
    expect(screen.getByText('overview.nurse.widgetMyQueue')).toBeInTheDocument();
  });
});
