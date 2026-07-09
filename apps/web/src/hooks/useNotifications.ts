import { trpc } from '../lib/trpc';

// S15b — Notification (uygulama-içi bildirim) query/mutation sarmalayıcı.
//
// Baseline 60sn poll (socket kopukken fallback); NotificationSocketProvider
// canlı push'ta query'leri invalidate eder → anlık güncelleme. Zil UI bu hook'u
// tüketir. Açık return tipi: trpc.useUtils() tipi çok büyük olduğundan inference
// serileştirme sınırını aşıyor (TS7056) — explicit annotation şart.

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

export interface UseNotificationsResult {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

export function useNotifications(): UseNotificationsResult {
  const utils = trpc.useUtils();

  const listQuery = trpc.notification.list.useQuery(
    { limit: 30, unreadOnly: false },
    { refetchInterval: 60_000 },
  );
  const unreadQuery = trpc.notification.unreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const invalidate = async () => {
    await Promise.all([
      utils.notification.list.invalidate(),
      utils.notification.unreadCount.invalidate(),
    ]);
  };

  const markRead = trpc.notification.markRead.useMutation({ onSuccess: invalidate });
  const markAllRead = trpc.notification.markAllRead.useMutation({ onSuccess: invalidate });

  return {
    notifications: (listQuery.data ?? []) as unknown as AppNotification[],
    unreadCount: unreadQuery.data ?? 0,
    isLoading: listQuery.isLoading,
    markRead: (id: string) => markRead.mutate({ id }),
    markAllRead: () => markAllRead.mutate(),
  };
}
