import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

let mockFlags: Record<string, unknown> | undefined;
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u', roles: ['doktor'], flags: mockFlags } }),
}));

interface Row {
  id: string;
  stage: string;
  stageUpdatedAt: string;
  appointment: { startsAt: string } | null;
  patient: { id: string; mrn: string; firstName: string; lastName: string; tags: string[] };
}
let worklistData: Row[] = [];
let apptData: { id: string; status: string; startsAt: string }[] = [];
let cosignData: { id: string; action: string; summary: string; patient: { name: string } }[] = [];
let surgeryData: {
  items: {
    id: string;
    scheduledAt: string;
    eyeSide: string;
    patient: { firstName: string; lastName: string };
  }[];
};

// #1066 — sayfa artık tek agregat sorgu kullanır (dashboard.doctorOverview).
vi.mock('../../lib/trpc', () => ({
  trpc: {
    dashboard: {
      doctorOverview: {
        useQuery: () => ({
          data: {
            worklist: worklistData,
            appointments: apptData,
            cosignPending: cosignData,
            surgeries: surgeryData,
          },
          isLoading: false,
          error: null,
        }),
      },
    },
  },
}));

import { DoctorOverview } from './DoctorOverview';

function patient(id: string): Row['patient'] {
  return { id, mrn: 'M' + id, firstName: 'Ad' + id, lastName: 'Soy', tags: [] };
}
function row(id: string, stage: string): Row {
  return {
    id,
    stage,
    stageUpdatedAt: '2026-06-25T08:00:00Z',
    appointment: null,
    patient: patient(id),
  };
}

function setup() {
  return render(
    <MemoryRouter>
      <DoctorOverview />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockFlags = undefined;
  worklistData = [];
  apptData = [];
  cosignData = [];
  surgeryData = { items: [] };
});

describe('DoctorOverview', () => {
  it('aktif in_exam varsa primary "Muayeneye Devam Et" ve etkin', () => {
    worklistData = [row('1', 'in_exam')];
    setup();
    const primary = screen.getByTestId('doctor-overview-primary');
    expect(primary).toHaveTextContent('overview.doctor.continueExam');
    expect(primary).toBeEnabled();
  });

  it('in_exam yok, bekleyen var → "Sıradaki Hastayı Al" etkin', () => {
    worklistData = [row('1', 'waiting_doctor')];
    setup();
    const primary = screen.getByTestId('doctor-overview-primary');
    expect(primary).toHaveTextContent('overview.doctor.takeNext');
    expect(primary).toBeEnabled();
  });

  it('3/3 aktif muayene → primary disabled + sebep', () => {
    worklistData = [
      row('1', 'in_exam'),
      row('2', 'in_exam'),
      row('3', 'in_exam'),
      row('4', 'waiting_doctor'),
    ];
    setup();
    // in_exam>0 → continue etiketi ama 3/3 → cap, yeni hasta alınamaz; continue hâlâ mümkün.
    // capReached sebebi görünür.
    expect(screen.getByText('overview.doctor.capReached')).toBeInTheDocument();
  });

  it('kuyruk boşsa primary disabled', () => {
    worklistData = [];
    setup();
    expect(screen.getByTestId('doctor-overview-primary')).toBeDisabled();
  });

  it('KPI sayımlarını gerçek veriden gösterir', () => {
    worklistData = [row('1', 'waiting_doctor'), row('2', 'measurement_ready')];
    apptData = [
      { id: 'a', status: 'scheduled', startsAt: '2026-06-25T09:00:00Z' },
      { id: 'b', status: 'checked_in', startsAt: '2026-06-25T10:00:00Z' },
      { id: 'c', status: 'completed', startsAt: '2026-06-25T11:00:00Z' },
    ];
    cosignData = [{ id: 'c1', action: 'create', summary: 'reçete', patient: { name: 'X' } }];
    surgeryData = {
      items: [
        {
          id: 's1',
          scheduledAt: '2026-06-25T12:00:00Z',
          eyeSide: 'od',
          patient: { firstName: 'P', lastName: 'Q' },
        },
      ],
    };
    setup();
    expect(screen.getByText('overview.doctor.kpiAppointments')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // bugün randevu
    expect(screen.getByText('overview.doctor.kpiCosign')).toBeInTheDocument();
  });

  it('misafir doktor → "Bugünkü Listem" başlığı', () => {
    mockFlags = { is_visiting_doctor: true };
    setup();
    expect(screen.getByText('overview.doctor.titleVisiting')).toBeInTheDocument();
  });
});
