import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PostExamDecisionPanel } from './PostExamDecisionPanel';

const activeQuery = vi.fn();

vi.mock('../../lib/trpc', () => ({
  trpc: {
    encounter: { activeForPatient: { useQuery: () => activeQuery() } },
    // S15-PR16 — refusal dialog için (Ali).
    surgery: { listByPatient: { useQuery: () => ({ data: [] }) } },
    billing: { listServiceItems: { useQuery: () => ({ data: [] }) } },
    measurementOrder: { create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
    useUtils: () => ({ encounter: { myWorklist: { invalidate: vi.fn() } } }),
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', roles: ['doktor'] } }),
}));

describe('PostExamDecisionPanel', () => {
  beforeEach(() => activeQuery.mockReset());

  it('aktif ziyaret in_exam ise 3 aksiyonlu panel gösterir', () => {
    activeQuery.mockReturnValue({ data: { id: 'e1', stage: 'in_exam' } });
    render(<PostExamDecisionPanel patientId="p1" />);
    expect(screen.getByTestId('post-exam-decision')).toBeInTheDocument();
    expect(screen.getByTestId('decision-prescription')).toBeInTheDocument();
    expect(screen.getByTestId('decision-measurement')).toBeInTheDocument();
    expect(screen.getByTestId('decision-surgery')).toBeInTheDocument();
  });

  it('karar-dışı istasyonda (waiting_doctor) render etmez', () => {
    activeQuery.mockReturnValue({ data: { id: 'e1', stage: 'waiting_doctor' } });
    const { container } = render(<PostExamDecisionPanel patientId="p1" />);
    expect(container.firstChild).toBeNull();
  });

  it('aktif ziyaret yoksa render etmez', () => {
    activeQuery.mockReturnValue({ data: null });
    const { container } = render(<PostExamDecisionPanel patientId="p1" />);
    expect(container.firstChild).toBeNull();
  });
});
