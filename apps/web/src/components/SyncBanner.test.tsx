import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SyncBanner } from './SyncBanner';
import type { SyncStatusState } from '../hooks/useSyncStatus';

const mockUseSyncStatus = vi.fn<() => SyncStatusState>();
vi.mock('../hooks/useSyncStatus', () => ({
  useSyncStatus: () => mockUseSyncStatus(),
}));

describe('SyncBanner', () => {
  beforeEach(() => {
    mockUseSyncStatus.mockReset();
  });
  afterEach(() => {
    mockUseSyncStatus.mockReset();
  });

  it('isLoading → null render', () => {
    mockUseSyncStatus.mockReturnValue({ status: null, offline: false, isLoading: true });
    const { container } = render(<SyncBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('offline → kırmızı çevrimdışı bar', () => {
    mockUseSyncStatus.mockReturnValue({ status: null, offline: true, isLoading: false });
    render(<SyncBanner />);
    expect(screen.getByTestId('sync-banner-offline')).toBeInTheDocument();
    expect(screen.getByText(/Çevrimdışı/)).toBeInTheDocument();
  });

  it('outboxFailed > 0 → sarı dead-letter bar', () => {
    mockUseSyncStatus.mockReturnValue({
      status: { outboxPending: 0, outboxFailed: 3, lastSyncAt: null, peerConfigured: true },
      offline: false,
      isLoading: false,
    });
    render(<SyncBanner />);
    expect(screen.getByTestId('sync-banner-failed')).toBeInTheDocument();
    expect(screen.getByText(/3 sync hatası/)).toBeInTheDocument();
  });

  it('outboxPending > 5 → açık sarı pending bar', () => {
    mockUseSyncStatus.mockReturnValue({
      status: { outboxPending: 10, outboxFailed: 0, lastSyncAt: null, peerConfigured: true },
      offline: false,
      isLoading: false,
    });
    render(<SyncBanner />);
    expect(screen.getByTestId('sync-banner-pending')).toBeInTheDocument();
    expect(screen.getByText(/10 kayıt sync bekliyor/)).toBeInTheDocument();
  });

  it('lastSyncAt > 10 dk → soluk stale bar', () => {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString();
    mockUseSyncStatus.mockReturnValue({
      status: {
        outboxPending: 0,
        outboxFailed: 0,
        lastSyncAt: fifteenMinAgo,
        peerConfigured: true,
      },
      offline: false,
      isLoading: false,
    });
    render(<SyncBanner />);
    expect(screen.getByTestId('sync-banner-stale')).toBeInTheDocument();
    expect(screen.getByText(/Son sync 15 dk önce/)).toBeInTheDocument();
  });

  it('healthy state (lastSync recent, no pending) → null render', () => {
    mockUseSyncStatus.mockReturnValue({
      status: {
        outboxPending: 0,
        outboxFailed: 0,
        lastSyncAt: new Date(Date.now() - 60_000).toISOString(),
        peerConfigured: true,
      },
      offline: false,
      isLoading: false,
    });
    const { container } = render(<SyncBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('peerConfigured false → stale uyarı gösterilmez (single-node deployment)', () => {
    mockUseSyncStatus.mockReturnValue({
      status: {
        outboxPending: 0,
        outboxFailed: 0,
        lastSyncAt: new Date(Date.now() - 60 * 60_000).toISOString(), // 1 saat önce
        peerConfigured: false,
      },
      offline: false,
      isLoading: false,
    });
    const { container } = render(<SyncBanner />);
    expect(container.firstChild).toBeNull();
  });

  // Yeni klinik kurulumunda setup wizard tenant + 7 rol + admin user yaratır →
  // sync_outbox 10 satıra atlar. Peer cloud henüz tanıtılmadığı için sync hiç
  // denenmiyor; "10 kayıt sync bekliyor" mesajı kullanıcıyı yanıltır.
  it('peerConfigured false + outboxPending > 5 → pending uyarısı gösterilmez', () => {
    mockUseSyncStatus.mockReturnValue({
      status: { outboxPending: 10, outboxFailed: 0, lastSyncAt: null, peerConfigured: false },
      offline: false,
      isLoading: false,
    });
    const { container } = render(<SyncBanner />);
    expect(container.firstChild).toBeNull();
  });
});
