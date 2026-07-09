import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NurseSessionWidget } from './NurseSessionWidget';

// v0.4 İP-8 (#544) — acting-doctor widget'ı yalnız Asistan modunda (+ mod'suz
// klasik hemşirede) görünür; Genel/Ölçüm modunda gizli.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../lib/trpc-error', () => ({ mapTrpcError: (e: unknown) => String(e) }));

// #937 sonrası NurseSessionWidget useConfirm() kullanıyor → ConfirmProvider gerekir.
// Testte sağlayıcı sarmalamak yerine hook mock'lanır (diğer mock'larla tutarlı).
vi.mock('../../hooks/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn(() => Promise.resolve(true)) }),
}));

let mockUser: { id: string; roles: string[]; mode?: string } | null = {
  id: 'u1',
  roles: ['hemsire'],
};
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      nurseSession: { my: { invalidate: vi.fn() } },
      encounter: { myWorklist: { invalidate: vi.fn() } },
      patient: { list: { invalidate: vi.fn() } },
    }),
    nurseSession: {
      my: { useQuery: () => ({ data: undefined, isLoading: false }) },
      start: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      end: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    // R2 (#724) — "Dr X: N/3 aktif" yük rozeti için.
    encounter: {
      myActiveExamCount: { useQuery: () => ({ data: { count: 1, cap: 3, isAtCap: false } }) },
    },
    doctor: { list: { useQuery: () => ({ data: { items: [] }, isLoading: false }) } },
  },
}));

function renderWidget(opts: { roles?: string[]; mode?: string } = {}) {
  mockUser = { id: 'u1', roles: opts.roles ?? ['hemsire'], mode: opts.mode };
  return render(<NurseSessionWidget />);
}

describe('NurseSessionWidget — mod gating', () => {
  it('Asistan mod hemşire: widget görünür (Başlat tetikleyici)', () => {
    renderWidget({ mode: 'asistan' });
    expect(screen.getByText('nurse:session.startButton')).toBeInTheDocument();
  });

  it('Klasik (mod yok) hemşire: widget görünür (geri-uyum)', () => {
    renderWidget({ mode: undefined });
    expect(screen.getByText('nurse:session.startButton')).toBeInTheDocument();
  });

  it('Genel mod: widget gizli', () => {
    renderWidget({ mode: 'genel' });
    expect(screen.queryByText('nurse:session.startButton')).not.toBeInTheDocument();
  });

  it('Ölçüm (kilitli) mod: widget gizli', () => {
    renderWidget({ mode: 'olcum' });
    expect(screen.queryByText('nurse:session.startButton')).not.toBeInTheDocument();
  });

  it('Hemşire olmayan: widget gizli', () => {
    renderWidget({ roles: ['doktor'], mode: undefined });
    expect(screen.queryByText('nurse:session.startButton')).not.toBeInTheDocument();
  });
});
