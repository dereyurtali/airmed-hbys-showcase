import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';

// A12 PR 5 — Sync status hook.
//
// /api/sync/status endpoint'ini her 30 sn poll eder. Network error → offline
// state. SyncBanner bu state'i okuyup gösterimi karar verir.
//
// Pilot scope'ta WebSocket push entegrasyonu yok; PR 4 gateway hazır ama
// status değişimlerini push eden event şu an yok. Polling yeterli.

export interface SyncStatus {
  outboxPending: number;
  outboxFailed: number;
  lastSyncAt: string | null;
  peerConfigured: boolean;
}

export interface SyncStatusState {
  status: SyncStatus | null;
  /** true ise son fetch network error → backend ulaşılamıyor */
  offline: boolean;
  /** Her 30 sn refresh; initial fetch için isLoading kısa süreyle true */
  isLoading: boolean;
}

const POLL_INTERVAL_MS = 30_000;

export function useSyncStatus(): SyncStatusState {
  const { isAuthenticated } = useAuth();
  const [state, setState] = useState<SyncStatusState>({
    status: null,
    offline: false,
    isLoading: true,
  });

  useEffect(() => {
    if (!isAuthenticated) {
      setState({ status: null, offline: false, isLoading: false });
      return;
    }
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await api.get<SyncStatus>('/sync/status');
        if (!cancelled) {
          setState({ status: res.data, offline: false, isLoading: false });
        }
      } catch (err) {
        if (!cancelled) {
          // Network hatası → offline state'e geç
          const isNetworkError =
            err instanceof Error &&
            ('code' in err
              ? (err as { code?: string }).code === 'ERR_NETWORK'
              : err.message.includes('Network'));
          setState((prev) => ({
            status: prev.status,
            offline: isNetworkError,
            isLoading: false,
          }));
        }
      }
    };

    void fetchStatus();
    const intervalId = window.setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isAuthenticated]);

  return state;
}
