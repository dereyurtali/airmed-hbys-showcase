import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { BackBar } from './BackBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => (k === 'actions.back' ? 'Geri' : k) }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockRoles: string[] = [];
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ user: { roles: mockRoles } }),
}));

function renderAt(path: string, roles: string[] = ['yonetici_asistani']) {
  mockNavigate.mockReset();
  mockRoles = roles;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BackBar />
    </MemoryRouter>,
  );
}

describe('BackBar', () => {
  describe('rota top-level kararı (rol-aware)', () => {
    it('tam sidebar (yonetici_asistani): /overview top-level → gizli', () => {
      // #908 — jenerik /dashboard emekli; evrensel top-level artık /overview
      // (ALWAYS_TOP_LEVEL, her varyantta pinned-top).
      renderAt('/overview', ['yonetici_asistani']);
      expect(screen.queryByRole('button', { name: 'Geri' })).not.toBeInTheDocument();
    });

    it('tam sidebar: /admin/users top-level (sidebar destinasyonu) → gizli', () => {
      renderAt('/admin/users', ['yonetici_asistani']);
      expect(screen.queryByRole('button', { name: 'Geri' })).not.toBeInTheDocument();
    });

    it('sadece-yönetici sade sidebar: /admin/users sidebar destinasyonu DEĞİL → görünür', () => {
      renderAt('/admin/users', ['yonetici']);
      expect(screen.getByRole('button', { name: 'Geri' })).toBeInTheDocument();
    });

    it('sadece-yönetici: /admin/permissions Ayarlar hub child → görünür', () => {
      renderAt('/admin/permissions', ['yonetici']);
      expect(screen.getByRole('button', { name: 'Geri' })).toBeInTheDocument();
    });

    it('sadece-yönetici: /admin/ayarlar hub sidebar destinasyonu → gizli', () => {
      renderAt('/admin/ayarlar', ['yonetici']);
      expect(screen.queryByRole('button', { name: 'Geri' })).not.toBeInTheDocument();
    });

    it('sadece-yönetici: /approvals sidebar destinasyonu (Onay Talepleri) → gizli', () => {
      renderAt('/approvals', ['yonetici']);
      expect(screen.queryByRole('button', { name: 'Geri' })).not.toBeInTheDocument();
    });

    it('sadece-doktor: /worklist top-level → gizli', () => {
      renderAt('/worklist', ['doktor']);
      expect(screen.queryByRole('button', { name: 'Geri' })).not.toBeInTheDocument();
    });

    it('sadece-doktor: /patients/abc-123 alt rota → görünür', () => {
      renderAt('/patients/abc-123', ['doktor']);
      expect(screen.getByRole('button', { name: 'Geri' })).toBeInTheDocument();
    });

    it('sadece-resepsiyon: /billing/inv-1 alt rota → görünür', () => {
      renderAt('/billing/inv-1', ['resepsiyon']);
      expect(screen.getByRole('button', { name: 'Geri' })).toBeInTheDocument();
    });

    it('ölçüm hemşiresi: /measurement-queue sidebar → gizli', () => {
      renderAt('/measurement-queue', ['olcum_hemsiresi']);
      expect(screen.queryByRole('button', { name: 'Geri' })).not.toBeInTheDocument();
    });
  });

  describe('alt rotada her zaman görünür', () => {
    it('tam sidebar: /patients/:id/edit → görünür', () => {
      renderAt('/patients/abc/edit', ['yonetici_asistani']);
      expect(screen.getByRole('button', { name: 'Geri' })).toBeInTheDocument();
    });

    it('tam sidebar: /billing/:id (InvoiceDetail) → görünür', () => {
      renderAt('/billing/inv-1', ['yonetici_asistani']);
      expect(screen.getByRole('button', { name: 'Geri' })).toBeInTheDocument();
    });

    it('herhangi bir rol: /admin/clinic-settings → görünür', () => {
      renderAt('/admin/clinic-settings', ['yonetici']);
      expect(screen.getByRole('button', { name: 'Geri' })).toBeInTheDocument();
    });

    it('herhangi bir rol: /change-password → gizli (auth flow)', () => {
      renderAt('/change-password', ['doktor']);
      expect(screen.queryByRole('button', { name: 'Geri' })).not.toBeInTheDocument();
    });
  });

  describe('click davranışı', () => {
    it('history > 1 ise navigate(-1)', () => {
      const orig = Object.getOwnPropertyDescriptor(window.history, 'length');
      Object.defineProperty(window.history, 'length', { configurable: true, value: 5 });
      renderAt('/patients/abc-123', ['yonetici_asistani']);
      fireEvent.click(screen.getByRole('button', { name: 'Geri' }));
      expect(mockNavigate).toHaveBeenCalledWith(-1);
      if (orig) Object.defineProperty(window.history, 'length', orig);
    });

    it('history yoksa: /billing/:id → /billing parent fallback', () => {
      const orig = Object.getOwnPropertyDescriptor(window.history, 'length');
      Object.defineProperty(window.history, 'length', { configurable: true, value: 1 });
      renderAt('/billing/inv-1', ['yonetici_asistani']);
      fireEvent.click(screen.getByRole('button', { name: 'Geri' }));
      expect(mockNavigate).toHaveBeenCalledWith('/billing', { replace: true });
      if (orig) Object.defineProperty(window.history, 'length', orig);
    });

    it('history yoksa: sadece-yönetici /admin/users → /admin/ayarlar (hub fallback)', () => {
      const orig = Object.getOwnPropertyDescriptor(window.history, 'length');
      Object.defineProperty(window.history, 'length', { configurable: true, value: 1 });
      renderAt('/admin/users', ['yonetici']);
      fireEvent.click(screen.getByRole('button', { name: 'Geri' }));
      expect(mockNavigate).toHaveBeenCalledWith('/admin/ayarlar', { replace: true });
      if (orig) Object.defineProperty(window.history, 'length', orig);
    });
  });
});
