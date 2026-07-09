import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

let pendingData: { id: string }[] = [];
let completedData: { id: string }[] = [];
vi.mock('../../lib/trpc', () => ({
  trpc: {
    measurementOrder: {
      listForUnit: {
        useQuery: (input: { completedToday?: boolean }) => ({
          data: input?.completedToday ? completedData : pendingData,
          isLoading: false,
          error: null,
        }),
      },
    },
  },
}));

import { MeasurementKioskOverview } from './MeasurementKioskOverview';

function setup() {
  return render(
    <MemoryRouter>
      <MeasurementKioskOverview />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  pendingData = [];
  completedData = [];
});

describe('MeasurementKioskOverview', () => {
  it('bekleyen > 0 → "Sıradakini Al" etkin + sayı gösterir', () => {
    pendingData = [{ id: '1' }, { id: '2' }, { id: '3' }];
    completedData = [{ id: 'c1' }];
    setup();
    expect(screen.getByTestId('kiosk-take-next')).toBeEnabled();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('bekleyen yok → "Sıradakini Al" disabled', () => {
    pendingData = [];
    setup();
    expect(screen.getByTestId('kiosk-take-next')).toBeDisabled();
  });
});
