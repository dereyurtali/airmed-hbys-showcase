import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useNotifications } from '../../hooks/useNotifications';

// S15b — Uygulama-içi bildirim zili. Okunmamış rozet + popover liste; tıkla →
// okundu işaretle + payload.patientId varsa hasta detayına derin bağlantı.
// #1018 — AI asistan devri bildirimi dış siteye (Chatwoot) YÖNLENDİRMEZ
// (kullanıcı kararı); tıklama yalnız okundu işaretler.

function patientIdOf(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'patientId' in payload) {
    const v = (payload as { patientId?: unknown }).patientId;
    if (typeof v === 'string') return v;
  }
  return null;
}

export function NotificationBell() {
  const { t } = useTranslation('notification');
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const items = notifications;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={t('bell.title')}
          data-testid="notification-bell"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white"
              data-testid="notification-badge"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">{t('bell.title')}</span>
          {unreadCount > 0 && (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => markAllRead()}
            >
              {t('bell.markAllRead')}
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('bell.empty')}</p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const pid = patientIdOf(n.payload);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted/50 ${
                        n.readAt ? '' : 'bg-blue-50/60'
                      }`}
                      onClick={() => {
                        markRead(n.id);
                        if (pid) navigate(`/patients/${pid}`);
                      }}
                    >
                      <span className="flex w-full items-center gap-2 text-sm font-medium">
                        {!n.readAt && (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600"
                            aria-hidden
                          />
                        )}
                        <span className="truncate">{n.title}</span>
                      </span>
                      {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
