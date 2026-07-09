import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';

// cmdk ResizeObserver + scrollIntoView kullanır; jsdom'da yok → stub (tarayıcıda native).
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = vi.fn();

// v0.4.2 G3 (#722) — Cmd/Ctrl+K command palette: rol-aware ekran-atlama + hasta arama.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

let mockCanSearch = true;
let mockPerms: Record<string, boolean> = {};
vi.mock('../../hooks/usePermission', () => ({
  usePermission: () => mockCanSearch,
  usePermissions: () => mockPerms,
}));

let mockUser: { id: string; roles: string[]; mode?: string; flags?: Record<string, unknown> } = {
  id: 'u1',
  roles: ['doktor'],
};
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('../../lib/trpc', () => ({
  trpc: {
    patient: { list: { useQuery: () => ({ data: undefined, isLoading: false }) } },
  },
}));

import { CommandPalette } from './CommandPalette';

function setup(
  opts: {
    canSearch?: boolean;
    perms?: Record<string, boolean>;
    mode?: string;
    flags?: Record<string, unknown>;
  } = {},
) {
  mockCanSearch = opts.canSearch ?? true;
  mockPerms = opts.perms ?? {};
  mockUser = { id: 'u1', roles: ['doktor'], mode: opts.mode, flags: opts.flags };
  return render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  );
}

describe('CommandPalette', () => {
  beforeEach(() => {
    mockCanSearch = true;
    mockPerms = {};
  });

  it('tetikleyici görünür (kilitli olmayan rol)', () => {
    setup();
    expect(screen.getByRole('button', { name: 'globalSearch.trigger' })).toBeInTheDocument();
  });

  it('kilitli kiosk (ölçüm modu) → palet yok (null)', () => {
    setup({ mode: 'olcum' });
    expect(screen.queryByRole('button', { name: 'globalSearch.trigger' })).not.toBeInTheDocument();
  });

  it('açılınca "Genel Bakış" her zaman görünür (yetkisiz komut)', () => {
    setup({ perms: {} });
    fireEvent.click(screen.getByRole('button', { name: 'globalSearch.trigger' }));
    expect(screen.getByText('nav.overview')).toBeInTheDocument();
  });

  it('nav komutları permission-filtreli (finans: billing+approvals, hasta yok)', () => {
    setup({
      canSearch: false,
      perms: { 'page:billing': true, 'action:approval.list': true },
    });
    fireEvent.click(screen.getByRole('button', { name: 'globalSearch.trigger' }));
    expect(screen.getByText('nav.overview')).toBeInTheDocument();
    expect(screen.getByText('nav.billing')).toBeInTheDocument();
    expect(screen.getByText('nav.approvals')).toBeInTheDocument();
    expect(screen.queryByText('nav.patients')).not.toBeInTheDocument();
    expect(screen.queryByText('nav.examQueue')).not.toBeInTheDocument();
  });

  it('hasta arama yetkisi yoksa Hastalar grubu yok (misafir/finans)', () => {
    setup({ canSearch: false, perms: { 'page:billing': true } });
    fireEvent.click(screen.getByRole('button', { name: 'globalSearch.trigger' }));
    expect(screen.queryByText('globalSearch.patientsHeading')).not.toBeInTheDocument();
  });

  it('misafir doktor: palet açılır (nav) ama hasta arama kapalı', () => {
    setup({ canSearch: true, flags: { is_visiting_doctor: true } });
    fireEvent.click(screen.getByRole('button', { name: 'globalSearch.trigger' }));
    expect(screen.getByText('nav.overview')).toBeInTheDocument();
    expect(screen.queryByText('globalSearch.patientsHeading')).not.toBeInTheDocument();
  });
});
