import { api } from './api';
import { useApiQuery } from './useApiQuery';

// #1057 — AdminShell (nav rozeti) + DashboardPage aynı sayaç için ayrı 60sn
// interval kuruyordu (2× istek/dk/sekme). Tek query key = React Query tek
// timer + tek istek paylaştırır; yeni tüketici de bu hook'u kullanmalı.
export function useUnreadFeedbackCount(accessToken: string | null) {
  return useApiQuery(
    ['feedback-unread-count'],
    () =>
      api<{ count: number }>('/platform/feedback/unread-count', {
        bearer: accessToken ?? undefined,
      }),
    { enabled: !!accessToken, refetchInterval: 60_000 },
  );
}
