import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DoctorDetailPage } from './DoctorDetailPage';

// #1149 — Hesaplı doktor (userId set) → kimlik/durum hesap üzerinden yönetilir:
// Düzenle + Pasifleştir gizli, "Hesabı yönet" kısayolu görünür, iletişim
// hesaptan beslenir. Profil-only doktor (userId null) → tam düzenleme korunur.

const findByIdQuery = vi.fn();

vi.mock('../lib/trpc', () => ({
  trpc: {
    doctor: {
      findById: { useQuery: () => findByIdQuery() },
      setAvailability: {
        useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
      },
      softDelete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({
      doctor: { findById: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } },
    }),
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'doc-1' }),
  useNavigate: () => vi.fn(),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('../hooks/usePermission', () => ({ usePermission: () => true }));
vi.mock('../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
// Klinik alt bölümler kendi trpc sorgularını açar → testte gürültüyü kes.
vi.mock('../components/doctor/AvailabilityEditor', () => ({ AvailabilityEditor: () => null }));
vi.mock('../components/doctor/DoctorLeavesSection', () => ({ DoctorLeavesSection: () => null }));
vi.mock('../components/doctor/DoctorPublicProfileCard', () => ({
  DoctorPublicProfileCard: () => null,
}));
vi.mock('../components/doctor/DoctorVisitingWindowsSection', () => ({
  DoctorVisitingWindowsSection: () => null,
}));

const baseDoctor = {
  id: 'doc-1',
  name: 'Dr. Test',
  specialty: 'Retina',
  type: 'local' as const,
  contactPhone: '+992 111',
  contactEmail: 'doctor-field@klinik.tj',
  commissionRate: '10.00',
  isActive: true,
  notes: null,
  availabilities: [],
};

describe('DoctorDetailPage — kimlik hesap tarafında (#1149)', () => {
  beforeEach(() => findByIdQuery.mockReset());

  it('hesaplı doktor: Düzenle/Pasifleştir gizli, "Hesabı yönet" + hesap iletişimi', () => {
    findByIdQuery.mockReturnValue({
      data: {
        ...baseDoctor,
        userId: 'user-9',
        user: {
          flags: null,
          name: 'Dr. Test',
          phone: '+992 999',
          email: 'account@klinik.tj',
          status: 'active',
        },
      },
      isLoading: false,
      error: null,
    });
    render(<DoctorDetailPage />);

    // Kimlik düzenleme yüzeyi yok
    expect(screen.queryByText('doctor:detail.actions.edit')).not.toBeInTheDocument();
    expect(screen.queryByText('doctor:detail.actions.deactivate')).not.toBeInTheDocument();

    // Hesaba kısayol + ipucu
    const manage = screen.getByText('doctor:detail.actions.manageAccount');
    expect(manage.closest('a')).toHaveAttribute('href', '/admin/users/user-9');
    expect(screen.getByText('doctor:detail.identityManagedHint')).toBeInTheDocument();

    // İletişim hesaptan beslenir (Doctor.contactPhone/Email değil)
    expect(screen.getByText('+992 999')).toBeInTheDocument();
    expect(screen.getByText('account@klinik.tj')).toBeInTheDocument();
    expect(screen.queryByText('+992 111')).not.toBeInTheDocument();
  });

  it('profil-only doktor (userId yok): Düzenle + Pasifleştir görünür, hesap kısayolu yok', () => {
    findByIdQuery.mockReturnValue({
      data: { ...baseDoctor, userId: null, user: null },
      isLoading: false,
      error: null,
    });
    render(<DoctorDetailPage />);

    const edit = screen.getByText('doctor:detail.actions.edit');
    expect(edit.closest('a')).toHaveAttribute('href', '/doctors/doc-1/edit');
    expect(screen.getByText('doctor:detail.actions.deactivate')).toBeInTheDocument();

    expect(screen.queryByText('doctor:detail.actions.manageAccount')).not.toBeInTheDocument();
    expect(screen.queryByText('doctor:detail.identityManagedHint')).not.toBeInTheDocument();

    // İletişim doktor kaydından (hesap yok)
    expect(screen.getByText('+992 111')).toBeInTheDocument();
    expect(screen.getByText('doctor-field@klinik.tj')).toBeInTheDocument();
  });
});
