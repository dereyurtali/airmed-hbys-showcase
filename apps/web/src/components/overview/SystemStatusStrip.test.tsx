import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import type { SyncStatusState } from '../../hooks/useSyncStatus';
import type { ReceiptAutoprintMode } from '../../lib/receipt-prefs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { count?: number }) => (opts?.count != null ? `${k}:${opts.count}` : k),
  }),
}));

const mockUseSyncStatus = vi.fn<() => SyncStatusState>();
vi.mock('../../hooks/useSyncStatus', () => ({
  useSyncStatus: () => mockUseSyncStatus(),
}));

let receiptMode: ReceiptAutoprintMode = 'auto';
vi.mock('../../lib/receipt-prefs', () => ({
  getReceiptAutoprintMode: () => receiptMode,
}));

import { SystemStatusStrip } from './SystemStatusStrip';

function setup() {
  return render(
    <MemoryRouter>
      <SystemStatusStrip />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseSyncStatus.mockReset();
  receiptMode = 'auto';
});

describe('SystemStatusStrip', () => {
  it('çevrimiçi + senkron güncel + makbuz oto', () => {
    mockUseSyncStatus.mockReturnValue({
      status: { outboxPending: 0, outboxFailed: 0, lastSyncAt: null, peerConfigured: true },
      offline: false,
      isLoading: false,
    });
    setup();
    expect(screen.getByText('overview.systemStatus.online')).toBeInTheDocument();
    expect(screen.getByText('overview.systemStatus.syncOk')).toBeInTheDocument();
    expect(screen.getByText('overview.systemStatus.receiptAuto')).toBeInTheDocument();
  });

  it('offline → çevrimdışı pill', () => {
    mockUseSyncStatus.mockReturnValue({ status: null, offline: true, isLoading: false });
    setup();
    expect(screen.getByText('overview.systemStatus.offline')).toBeInTheDocument();
  });

  it('outboxFailed > 0 → sync hatası sayacı', () => {
    mockUseSyncStatus.mockReturnValue({
      status: { outboxPending: 0, outboxFailed: 2, lastSyncAt: null, peerConfigured: true },
      offline: false,
      isLoading: false,
    });
    setup();
    expect(screen.getByText('overview.systemStatus.syncFailed:2')).toBeInTheDocument();
  });

  it('peer yapılandırılmamış → yerel kayıt (uyarı değil)', () => {
    mockUseSyncStatus.mockReturnValue({
      status: { outboxPending: 20, outboxFailed: 0, lastSyncAt: null, peerConfigured: false },
      offline: false,
      isLoading: false,
    });
    setup();
    expect(screen.getByText('overview.systemStatus.syncLocal')).toBeInTheDocument();
  });

  it('makbuz manuel tercihinde manuel etiket + tercih linki', () => {
    receiptMode = 'manual';
    mockUseSyncStatus.mockReturnValue({ status: null, offline: false, isLoading: false });
    setup();
    const link = screen.getByText('overview.systemStatus.receiptManual').closest('a');
    expect(link).toHaveAttribute('href', '/reception/preferences');
  });
});
