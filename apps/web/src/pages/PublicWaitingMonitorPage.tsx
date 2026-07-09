import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Hourglass, Maximize, Megaphone, Minimize, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../providers/LocaleProvider';
import { localeToIntl } from '../lib/i18n-format';
import { cn } from '../lib/utils';

// #1159 — Lobi TV kiosk (Raspberry Pi). KİMLİK GEREKTİRMEZ: veri yayın anahtarıyla
// (?key=) public endpoint'ten gelir. Server-side anonim satırlar.
interface PublicWaitingRow {
  id: string;
  displayName: string; // "Ayşe K."
  kind: 'measurement' | 'doctor';
  doctorName: string | null;
}

const COLUMN_CAP = 8;
const DISPLAY_KEY_STORAGE = 'publicMonitor.displayKey';

type MonitorLang = 'tr' | 'ru' | 'tg';
const ALL_LANGS: readonly MonitorLang[] = ['tr', 'ru', 'tg'];
const LANG_STORAGE_KEY = 'publicMonitor.languages';
const MAX_LANGS = 2;

// Yayın anahtarını URL'den al → localStorage'a yaz → URL'den temizle (replaceState).
// Böylece Pi tek sefer key'li URL açar; sonra temiz URL'de kalıcı çalışır.
function readDisplayKey(): string | null {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('key');
    if (fromUrl) {
      localStorage.setItem(DISPLAY_KEY_STORAGE, fromUrl);
      url.searchParams.delete('key');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      return fromUrl;
    }
    return localStorage.getItem(DISPLAY_KEY_STORAGE);
  } catch {
    return null;
  }
}

function loadLangs(fallback: MonitorLang): MonitorLang[] {
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((l): l is MonitorLang => ALL_LANGS.includes(l as MonitorLang));
        if (valid.length > 0) return valid.slice(0, MAX_LANGS);
      }
    }
  } catch {
    /* localStorage okunamadı — fallback */
  }
  return [fallback];
}

// Çok-dilli başlık: seçili her dil ayrı satırda (stacked), birincil büyük.
function BiLabel({
  parts,
  primaryClassName,
  secondaryClassName,
}: {
  parts: string[];
  primaryClassName: string;
  secondaryClassName: string;
}) {
  return (
    <span className="flex flex-col leading-tight">
      {parts.map((p, i) => (
        <span key={i} className={i === 0 ? primaryClassName : secondaryClassName}>
          {p}
        </span>
      ))}
    </span>
  );
}

// TV kiosk tam ekran: browser çubuklarını gizler (Fullscreen API, user-gesture).
function useFullscreen(): { isFullscreen: boolean; toggle: () => void; supported: boolean } {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const supported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.();
  };
  return { isFullscreen, toggle, supported };
}

// Personel kontrollerini etkileşimde göster, boşta ~6sn sonra gizle (temiz hasta ekranı).
function useAutoHideControls(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      setVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVisible(false), 6000);
    };
    window.addEventListener('mousemove', reveal);
    window.addEventListener('touchstart', reveal);
    window.addEventListener('keydown', reveal);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('mousemove', reveal);
      window.removeEventListener('touchstart', reveal);
      window.removeEventListener('keydown', reveal);
    };
  }, []);
  return visible;
}

// #1067 — saat tick'i kendi child'ında izole: dakika hassasiyetli 30sn tick.
function LobbyClock({ intlLocale }: { intlLocale: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-right">
      <div className="text-4xl font-semibold tabular-nums tracking-tight text-slate-800">
        {now.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="mt-0.5 text-sm text-slate-400">
        {now.toLocaleDateString(intlLocale, { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>
    </div>
  );
}

/**
 * S15-PR13 / #1159 — Public Waiting Monitor (Raspberry Pi lobi TV). Kimliksiz
 * (yayın anahtarı), 7/24 dayanıklı: kesintide sert hata YOK — son veri ekranda
 * kalır + "yeniden bağlanılıyor" + 10sn oto-retry (F5 gerekmez). Üstte tek büyük
 * "ŞU AN ÇAĞRILIYOR" bandı + ÖLÇÜM | DOKTOR sütunları. Mahremiyet server-side:
 * "Ad S.", MRN/tam-soyad/tıbbi bilgi payload'da yok. Çok dil (1-2) yalnız
 * başlıklarda; personel kontrolleri (dil/tam ekran) etkileşimde belirir.
 */
export function PublicWaitingMonitorPage() {
  const { t, i18n } = useTranslation(['encounter', 'common']);
  const { locale } = useLocale();
  const {
    isFullscreen,
    toggle: toggleFullscreen,
    supported: fullscreenSupported,
  } = useFullscreen();
  const controlsVisible = useAutoHideControls();

  const [displayKey] = useState<string | null>(() => readDisplayKey());

  const appLang: MonitorLang = ALL_LANGS.includes(locale as MonitorLang)
    ? (locale as MonitorLang)
    : 'tr';
  const [langs, setLangs] = useState<MonitorLang[]>(() => loadLangs(appLang));
  useEffect(() => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, JSON.stringify(langs));
    } catch {
      /* sessiz geç */
    }
  }, [langs]);

  const toggleLang = (l: MonitorLang) => {
    setLangs((prev) => {
      if (prev.includes(l)) return prev.length > 1 ? prev.filter((x) => x !== l) : prev;
      if (prev.length >= MAX_LANGS) return [prev[prev.length - 1], l];
      return [...prev, l];
    });
  };

  const fixedTs = langs.map((l) => i18n.getFixedT(l, 'encounter'));
  const labelParts = (key: string): string[] => fixedTs.map((ft) => ft(key) as string);
  const bi = (key: string, opts?: Record<string, unknown>): string =>
    [...new Set(fixedTs.map((ft) => ft(key, opts) as string))].join('  ·  ');

  // Public veri: yayın anahtarıyla, kimliksiz. keepPreviousData → kesintide son
  // veri ekranda kalır; 10sn oto-retry ağ/sunucu dönünce kendiliğinden toparlar.
  const query = useQuery<{ rows: PublicWaitingRow[] }, Error>({
    queryKey: ['public-waiting-monitor', displayKey],
    enabled: !!displayKey,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    retry: true,
    placeholderData: (prev) => prev,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/public/waiting-monitor?key=${encodeURIComponent(displayKey ?? '')}`,
        { signal },
      );
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { rows: PublicWaitingRow[] };
    },
  });

  const rows = query.data?.rows ?? [];
  const hasData = query.data !== undefined;
  const isInvalidKey = query.error?.message === '401';
  const reconnecting = hasData && query.isError; // veri var ama son deneme düştü

  const nowCalling = rows[0] ?? null;
  const measRows = rows.filter((r) => r.id !== nowCalling?.id && r.kind === 'measurement');
  const docRows = rows.filter((r) => r.id !== nowCalling?.id && r.kind === 'doctor');

  const heroDestination = (row: PublicWaitingRow): string =>
    row.kind === 'measurement'
      ? bi('publicMonitor.measurement')
      : row.doctorName
        ? `Dr. ${row.doctorName}`
        : bi('publicMonitor.toDoctor');

  const languageBar = (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          'flex items-center gap-3 transition-opacity duration-300',
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div
          role="group"
          aria-label={t('encounter:publicMonitor.displayLanguage', { defaultValue: 'Ekran dili' })}
          className="flex items-center gap-1.5"
        >
          {ALL_LANGS.map((l) => {
            const active = langs.includes(l);
            return (
              <button
                key={l}
                type="button"
                onClick={() => toggleLang(l)}
                aria-pressed={active}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-semibold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0166a8]/40',
                  active
                    ? 'bg-[#0166a8] text-white'
                    : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                )}
              >
                {l}
              </button>
            );
          })}
        </div>
        {fullscreenSupported && (
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={
              isFullscreen
                ? t('encounter:publicMonitor.exitFullscreen', { defaultValue: 'Tam ekrandan çık' })
                : t('encounter:publicMonitor.fullscreen', { defaultValue: 'Tam ekran' })
            }
            title={
              isFullscreen
                ? t('encounter:publicMonitor.exitFullscreen', { defaultValue: 'Tam ekrandan çık' })
                : t('encounter:publicMonitor.fullscreen', { defaultValue: 'Tam ekran' })
            }
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0166a8]/40"
          >
            {isFullscreen ? (
              <Minimize className="h-5 w-5" aria-hidden />
            ) : (
              <Maximize className="h-5 w-5" aria-hidden />
            )}
          </button>
        )}
      </div>
      <LobbyClock intlLocale={localeToIntl(langs[0])} />
    </div>
  );

  const renderColumn = (titleKey: string, colRows: PublicWaitingRow[], showDoctor: boolean) => {
    const shown = colRows.slice(0, COLUMN_CAP);
    const extra = colRows.length - shown.length;
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-7">
        <BiLabel
          parts={labelParts(titleKey)}
          primaryClassName="text-2xl font-bold uppercase tracking-wide text-slate-700"
          secondaryClassName="text-base font-semibold uppercase tracking-wide text-slate-400"
        />
        <div className="mt-5 space-y-4">
          {shown.length === 0 ? (
            <p className="text-3xl text-slate-300">—</p>
          ) : (
            shown.map((row) => (
              <div
                key={row.id}
                className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-3 last:border-0 last:pb-0"
              >
                <span className="truncate text-4xl font-semibold text-slate-900">
                  {row.displayName}
                </span>
                {showDoctor && row.doctorName && (
                  <span className="shrink-0 text-2xl text-slate-500">Dr. {row.doctorName}</span>
                )}
              </div>
            ))
          )}
          {extra > 0 && (
            <p className="pt-1 text-xl font-medium text-slate-400">
              {bi('publicMonitor.morePatients', { count: extra })}
            </p>
          )}
        </div>
      </section>
    );
  };

  // Kimliksiz durum ekranları (kiosk-dostu, sakin) — anahtar yok / geçersiz /
  // ilk bağlantı bekleniyor. Sert "hata" kartı YOK.
  const statusScreen = (icon: ReactNode, parts: string[]) => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#f8fafc] px-12 text-center">
      {icon}
      <BiLabel
        parts={parts}
        primaryClassName="max-w-3xl text-4xl font-semibold text-slate-500"
        secondaryClassName="max-w-3xl text-2xl font-medium text-slate-400"
      />
    </div>
  );

  if (!displayKey) {
    return statusScreen(
      <Hourglass className="h-16 w-16 text-slate-300" aria-hidden />,
      labelParts('publicMonitor.setupRequired'),
    );
  }
  if (!hasData && isInvalidKey) {
    return statusScreen(
      <WifiOff className="h-16 w-16 text-slate-300" aria-hidden />,
      labelParts('publicMonitor.invalidKey'),
    );
  }
  if (!hasData) {
    return statusScreen(
      <Hourglass
        className="h-16 w-16 animate-pulse text-slate-300 motion-reduce:animate-none"
        aria-hidden
      />,
      labelParts('publicMonitor.connecting'),
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <div className="h-1.5 w-full bg-gradient-to-r from-[#26296b] via-[#34306e] to-[#5a3a56]" />

      <div className="mx-auto max-w-7xl px-12 pb-12 pt-8">
        <header className="mb-8 flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <BiLabel
              parts={labelParts('publicMonitor.title')}
              primaryClassName="text-2xl font-bold tracking-tight text-slate-800"
              secondaryClassName="text-lg font-semibold text-slate-400"
            />
            {/* Kesinti göstergesi: veri var ama son deneme düştü → sessiz uyarı. */}
            {reconnecting && (
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">
                <WifiOff className="h-4 w-4" aria-hidden />
                {t('encounter:publicMonitor.reconnecting', {
                  defaultValue: 'Yeniden bağlanılıyor…',
                })}
              </span>
            )}
          </div>
          {languageBar}
        </header>

        {!nowCalling ? (
          <div className="flex flex-col items-center gap-5 rounded-3xl border border-slate-200 bg-white p-24 text-center">
            <Hourglass className="h-16 w-16 text-slate-300" aria-hidden />
            <BiLabel
              parts={labelParts('publicMonitor.empty')}
              primaryClassName="text-4xl font-semibold text-slate-400"
              secondaryClassName="text-2xl font-medium text-slate-300"
            />
          </div>
        ) : (
          <div className="space-y-8">
            <section className="rounded-3xl border border-[#0166a8]/20 border-l-[8px] border-l-[#0166a8] bg-[#0166a8]/[0.05] px-9 py-8">
              <div className="flex items-center gap-2.5">
                <Megaphone className="h-6 w-6 shrink-0 text-[#0166a8]" aria-hidden />
                <BiLabel
                  parts={labelParts('publicMonitor.nowCalling')}
                  primaryClassName="text-lg font-bold uppercase tracking-widest text-[#0166a8]"
                  secondaryClassName="text-sm font-semibold uppercase tracking-widest text-[#0166a8]/70"
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
                <span className="text-7xl font-bold tracking-tight text-slate-900">
                  {nowCalling.displayName}
                </span>
                <span className="inline-flex items-center gap-4 text-5xl font-semibold text-[#0166a8]">
                  <ArrowRight className="h-12 w-12 shrink-0" aria-hidden />
                  {heroDestination(nowCalling)}
                </span>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {renderColumn('publicMonitor.measurement', measRows, false)}
              {renderColumn('publicMonitor.toDoctor', docRows, true)}
            </div>
          </div>
        )}

        <footer className="mt-10 flex flex-col items-center gap-1 text-center">
          <BiLabel
            parts={labelParts('publicMonitor.subtitle')}
            primaryClassName="text-base text-slate-400"
            secondaryClassName="text-sm text-slate-300"
          />
          <span className="text-xs text-slate-300">{bi('publicMonitor.refreshNote')}</span>
        </footer>
      </div>
    </div>
  );
}
