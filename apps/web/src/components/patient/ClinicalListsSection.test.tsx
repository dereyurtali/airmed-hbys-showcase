import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ClinicalListsSection } from './ClinicalListsSection';

const h = vi.hoisted(() => ({
  problemsData: vi.fn(),
  medsData: vi.fn(),
  createProblemMutate: vi.fn(),
  canManage: true,
}));

vi.mock('../../lib/trpc', () => {
  const mut = (mutate: () => void) => ({ useMutation: () => ({ mutate, isPending: false }) });
  return {
    trpc: {
      clinicalList: {
        listProblems: { useQuery: () => h.problemsData() },
        listMedications: { useQuery: () => h.medsData() },
        createProblem: mut(h.createProblemMutate),
        resolveProblem: mut(vi.fn()),
        deleteProblem: mut(vi.fn()),
        createMedication: mut(vi.fn()),
        stopMedication: mut(vi.fn()),
        deleteMedication: mut(vi.fn()),
      },
      useUtils: () => ({
        clinicalList: {
          listProblems: { invalidate: vi.fn() },
          listMedications: { invalidate: vi.fn() },
        },
      }),
    },
  };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('../../hooks/usePermission', () => ({ usePermission: () => h.canManage }));

describe('ClinicalListsSection — R1 problem + ilaç listesi', () => {
  beforeEach(() => {
    h.createProblemMutate.mockReset();
    h.canManage = true;
    h.problemsData.mockReturnValue({
      data: [{ id: 'p1', description: 'Glokom', icd10: 'H40', status: 'active' }],
    });
    h.medsData.mockReturnValue({
      data: [
        { id: 'm1', name: 'Latanoprost', dose: '1 damla', frequency: 'gece', status: 'active' },
      ],
    });
  });

  it('problem + ilaç kayıtlarını listeler', () => {
    render(<ClinicalListsSection patientId="pt1" />);
    expect(screen.getByText('Glokom')).toBeInTheDocument();
    expect(screen.getByText('Latanoprost')).toBeInTheDocument();
  });

  it('yetki varsa ekleme formu render eder ve submit mutation çağırır', () => {
    render(<ClinicalListsSection patientId="pt1" />);
    const input = screen.getByPlaceholderText('patient:clinicalLists.problemPlaceholder');
    fireEvent.change(input, { target: { value: 'Katarakt' } });
    // İlk "Ekle" butonu problem formu.
    fireEvent.click(screen.getAllByText('common:actions.add')[0]);
    expect(h.createProblemMutate).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'pt1', description: 'Katarakt' }),
    );
  });

  it('yetki yoksa ekleme formu gizli', () => {
    h.canManage = false;
    render(<ClinicalListsSection patientId="pt1" />);
    expect(
      screen.queryByPlaceholderText('patient:clinicalLists.problemPlaceholder'),
    ).not.toBeInTheDocument();
    // Kayıtlar yine görünür (read-only).
    expect(screen.getByText('Glokom')).toBeInTheDocument();
  });
});
