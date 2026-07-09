import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { getAccessToken } from '../lib/api';
import i18n from '../i18n';
import { trpc } from '../lib/trpc';
import { useAuth } from './AuthProvider';

// S15b — Notification real-time köprüsü. Mevcut /sync socket.io namespace'ine
// bağlanır (server SyncGateway, `notification.new` event). Kendi recipientUserId'mize
// gelen bildirimde React Query'leri invalidate eder (anlık güncelleme) + toast.
// Socket kopuksa useNotifications'ın 60sn poll'u fallback olur.

// Socket origin: VITE_API_URL verilirse ondan (/api soneki atılır); yoksa dev'de doğrudan
// :3001, prod'da same-origin (Caddy `/socket.io/*` → api:3001 proxy'ler). Prod bundle'a
// localhost gömülmez — aksi halde tarayıcı kendi makinesine bağlanmaya çalışırdı.
const apiBaseUrl = import.meta.env.VITE_API_URL as string | undefined;
const SOCKET_ORIGIN = apiBaseUrl
  ? apiBaseUrl.replace(/\/api\/?$/, '')
  : import.meta.env.DEV
    ? 'http://localhost:3001'
    : window.location.origin;
const SOCKET_URL = `${SOCKET_ORIGIN}/sync`;

interface NotificationPushPayload {
  recipientUserId: string;
  notification: { id: string; title: string };
}

export function NotificationSocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const token = getAccessToken();
    if (!token) return;

    const socket: Socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
    });

    socket.on('notification.new', (payload: NotificationPushPayload) => {
      // Tenant room'a yayılır; yalnız bana geleni işle.
      if (payload.recipientUserId !== user.id) return;
      void utils.notification.list.invalidate();
      void utils.notification.unreadCount.invalidate();
      // Ölçüm-hazır gibi istasyon bildirimleri iş kuyruğunu da etkiler.
      void utils.encounter.myWorklist.invalidate();
      toast(payload.notification.title);
    });

    // S15-PR12 — Ölçüm hazır broadcast: tenant room'daki tüm clientlar alır;
    // sadece istek sahibi doktor için worklist invalidate + glow/toast.
    socket.on(
      'measurement.ready',
      (payload: { doctorUserId: string | null; patientId: string }) => {
        if (payload.doctorUserId !== user.id) return;
        void utils.encounter.myWorklist.invalidate();
        toast.success(i18n.t('notification:realtime.measurementReady'));
      },
    );

    // #363 — Yeni ölçüm talebi: ölçüm istasyonu kuyruğunu anında tazele (30 sn
    // poll'u beklemeden). Sesli/görsel uyarı istasyon sayfasında count artışından
    // tetiklenir; burada yalnız listeyi invalidate ederiz (mount değilse no-op).
    socket.on('measurement.ordered', () => {
      void utils.measurementOrder.listForUnit.invalidate();
    });

    return () => {
      socket.off('notification.new');
      socket.off('measurement.ready');
      socket.off('measurement.ordered');
      socket.disconnect();
    };
  }, [isAuthenticated, user, utils]);

  return <>{children}</>;
}
