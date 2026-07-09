import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

type Q = { data: unknown; isLoading: boolean; error: null };
const q = (data: unknown): Q => ({ data, isLoading: false, error: null });

let pipelineData: {
  id: string;
  eyeSide: string | null;
  patient: { firstName: string; lastName: string; mrn: string };
}[] = [];
let upcomingData: {
  items: {
    id: string;
    scheduledAt: string;
    eyeSide: string | null;
    patient: { firstName: string; lastName: string };
  }[];
};
let recallData: { id: string; patient: { firstName: string; lastName: string; mrn: string } }[] =
  [];

vi.mock('../../lib/trpc', () => ({
  trpc: {
    surgery: {
      salesPipeline: { useQuery: () => q(pipelineData) },
      list: { useQuery: () => q(upcomingData) },
    },
    recall: { list: { useQuery: () => q(recallData) } },
  },
}));

import { SalesOverview } from './SalesOverview';

function setup() {
  return render(
    <MemoryRouter>
      <SalesOverview />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  pipelineData = [];
  upcomingData = { items: [] };
  recallData = [];
});

describe('SalesOverview', () => {
  it('devir bekleyen KPI + sayım gösterir', () => {
    pipelineData = [
      { id: 'p1', eyeSide: 'od', patient: { firstName: 'A', lastName: 'B', mrn: 'M1' } },
      { id: 'p2', eyeSide: null, patient: { firstName: 'C', lastName: 'D', mrn: 'M2' } },
    ];
    setup();
    expect(screen.getByText('overview.sales.kpiHandoff')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('göz tarafı eksik devir satırında uyarı gösterir', () => {
    pipelineData = [
      { id: 'p1', eyeSide: null, patient: { firstName: 'A', lastName: 'B', mrn: 'M1' } },
    ];
    setup();
    expect(screen.getByText('overview.sales.eyeMissing')).toBeInTheDocument();
  });

  it('yaklaşan ameliyat KPI etiketini gösterir', () => {
    setup();
    expect(screen.getByText('overview.sales.kpiWeek')).toBeInTheDocument();
  });
});
