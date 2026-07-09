import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ImpersonationBanner } from './ImpersonationBanner';
import type { AuthUser } from '../providers/AuthProvider';

const mockUseAuth = vi.fn<() => { user: AuthUser | null; logout: () => Promise<void> }>();
vi.mock('../providers/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('../providers/AuthProvider')>(
    '../providers/AuthProvider',
  );
  return { ...actual, useAuth: () => mockUseAuth() };
});

vi.mock('../lib/api', () => ({
  api: { post: vi.fn().mockResolvedValue({}) },
  setAccessToken: vi.fn(),
}));

const baseUser: AuthUser = {
  id: 'user-a',
  email: 'admin@a.tj',
  tenantId: 'tenant-a',
  roles: ['yonetici'],
  impersonation: null,
};

describe('ImpersonationBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    mockUseAuth.mockReset();
  });

  it('user.impersonation null ise hiç render etmez (null döner)', () => {
    mockUseAuth.mockReturnValue({ user: baseUser, logout: vi.fn() });
    const { container } = render(<ImpersonationBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('impersonation context dolu → banner görünür, byName + target email + Çıkış butonu', () => {
    const expiresAt = new Date(Date.now() + 14 * 60 * 1000 + 23 * 1000); // 14m 23s
    mockUseAuth.mockReturnValue({
      user: {
        ...baseUser,
        impersonation: { id: 'imp-1', by: 'admin-1', byName: 'support@dna.com', expiresAt },
      },
      logout: vi.fn(),
    });
    render(<ImpersonationBanner />);

    expect(screen.getByTestId('impersonation-banner')).toBeInTheDocument();
    expect(screen.getByText(/support@dna\.com/)).toBeInTheDocument();
    expect(screen.getByText(/admin@a\.tj/)).toBeInTheDocument();
    // Countdown ~14:23 (initial tick — within first second)
    expect(screen.getByTestId('impersonation-remaining').textContent).toMatch(/14:2\d/);
    expect(screen.getByTestId('impersonation-stop')).toHaveTextContent(/Çıkış/);
  });

  it('expiresAt geçtiyse "Süresi doldu" gösterir', () => {
    mockUseAuth.mockReturnValue({
      user: {
        ...baseUser,
        impersonation: {
          id: 'imp-1',
          by: 'admin-1',
          byName: 'support@dna.com',
          expiresAt: new Date(Date.now() - 1_000),
        },
      },
      logout: vi.fn(),
    });
    render(<ImpersonationBanner />);
    expect(screen.getByTestId('impersonation-remaining')).toHaveTextContent('Süresi doldu');
  });
});
