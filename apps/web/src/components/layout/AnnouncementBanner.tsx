import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../lib/api';

// #1093 — Platform duyuru banner'ı (login sonrası). Kullanıcı-başına dismiss
// localStorage'da; kritik (warning) severity dismiss'siz. Sık poll gerekmez —
// mount'ta bir kez çeker (duyuru nadir + yayın/bitiş zamanlı).
interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: string;
  dismissible: boolean;
}

const DISMISS_KEY = 'airmed.announce.dismissed';

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed());

  useEffect(() => {
    let cancelled = false;
    api
      .get<Announcement[]>('/announcements/active')
      .then((res) => {
        if (!cancelled) setItems(res.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      // localStorage erişilemezse sessiz geç.
    }
  };

  const visible = items.filter((a) => !a.dismissible || !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="mb-4 space-y-2" data-testid="announcement-banner">
      {visible.map((a) => {
        const warn = a.severity === 'warning';
        return (
          <div
            key={a.id}
            role="status"
            className={
              'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ' +
              (warn
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-sky-200 bg-sky-50 text-sky-900')
            }
          >
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{a.title}</div>
              <div className="mt-0.5 whitespace-pre-wrap">{a.body}</div>
            </div>
            {a.dismissible && (
              <button
                type="button"
                onClick={() => dismiss(a.id)}
                className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
