import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ExaminationForm } from './ExaminationForm';

// R1 (#723) — "Bitir+Reçete tek hamle": activeEncounterId verilince create
// modunda birincil aksiyon "Kaydet + Muayeneyi Bitir" (final-save → encounter close).

let createOpts: { onSuccess: (c: { id: string }) => Promise<void>; onError: (e: unknown) => void };
const createMutate = vi.fn();
const updateMutate = vi.fn();
const closeMutateAsync = vi.fn().mockResolvedValue({});
const invalidate = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lib/trpc', () => ({
  trpc: {
    examination: {
      openDraft: { useQuery: () => ({ data: null }) },
      create: {
        useMutation: (opts: typeof createOpts) => {
          createOpts = opts;
          return { mutate: createMutate, isPending: false };
        },
      },
      update: { useMutation: () => ({ mutate: updateMutate, isPending: false }) },
    },
    encounter: {
      close: { useMutation: () => ({ mutateAsync: closeMutateAsync, isPending: false }) },
    },
    useUtils: () => ({
      examination: {
        openDraft: { invalidate },
        listByPatient: { invalidate },
        findById: { invalidate },
      },
      encounter: {
        myWorklist: { invalidate },
        activeForPatient: { invalidate },
        myActiveExamCount: { invalidate },
      },
    }),
  },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('./IcdCodePicker', () => ({ IcdCodePicker: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  patientId: 'p1',
  doctorUserId: 'u1',
  onSaved: vi.fn(),
};

describe('ExaminationForm — R1 tek-hamle bitir', () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    closeMutateAsync.mockClear();
  });

  it('aktif ziyaret yoksa tek "Kaydet" gösterir (bitir butonu yok)', () => {
    render(<ExaminationForm {...baseProps} />);
    expect(screen.queryByText('examination:form.saveAndFinish')).not.toBeInTheDocument();
    expect(screen.queryByText('examination:form.saveOnly')).not.toBeInTheDocument();
    expect(screen.getByText('examination:form.submit')).toBeInTheDocument();
  });

  it('aktif in_exam ziyaret varsa "Kaydet + Muayeneyi Bitir" + "Sadece Kaydet" gösterir', () => {
    render(<ExaminationForm {...baseProps} activeEncounterId="e1" />);
    expect(screen.getByText('examination:form.saveAndFinish')).toBeInTheDocument();
    expect(screen.getByText('examination:form.saveOnly')).toBeInTheDocument();
  });

  it('"Kaydet + Muayeneyi Bitir" → final create sonrası encounter close çağrılır', async () => {
    render(<ExaminationForm {...baseProps} activeEncounterId="e1" />);
    fireEvent.click(screen.getByText('examination:form.saveAndFinish'));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ status: 'final' }));
    // create başarılı → finalize zinciri encounter'ı kapatır.
    await createOpts.onSuccess({ id: 'exam-new' });
    await waitFor(() => expect(closeMutateAsync).toHaveBeenCalledWith({ id: 'e1' }));
  });

  it('"Sadece Kaydet" → final create yapar ama encounter close yapmaz', async () => {
    render(<ExaminationForm {...baseProps} activeEncounterId="e1" />);
    fireEvent.click(screen.getByText('examination:form.saveOnly'));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ status: 'final' }));
    await createOpts.onSuccess({ id: 'exam-new' });
    expect(closeMutateAsync).not.toHaveBeenCalled();
  });
});
