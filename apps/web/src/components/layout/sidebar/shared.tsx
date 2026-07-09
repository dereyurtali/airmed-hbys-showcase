import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BRAND_GRADIENT, BRAND_MESH_BACKGROUND } from '../../../lib/brand';
import { useClinic } from '../../../hooks/useClinic';
import type { Permission } from '@airmed/contracts';
import { cn } from '../../../lib/utils';
import { useAuth } from '../../../providers/AuthProvider';

// v0.4 (#541) — Sidebar tek dosyadan rol-başına dosyalara bölündü
// (çakışmasızlık sözleşmesi §1: her rol kendi dosyasında → İP-7/8/9/10/23 farklı
// dosyalara dokunur). Bu dosya tüm varyantların paylaştığı yapıyı tutar.
//
// v0.4.2 (#808 Şerit B) görsel omurga — Bölüm 24.2 "Disciplined Density":
// marka gradient YALNIZ 104px header'da (tek marka işareti); gövde açık zemin,
// aktif nav `bg-primary/10 text-primary`, bekleyen-sayı rozetleri amber, satır
// 40px, `.focus-ring`, gölge yok. (Önceki v0.4.1 #682: tüm yüzey dikey gradient +
// beyaz item — Bölüm 24 ile birlikte terk edildi; apps/admin AdminShell ile
// hizalı.) Gruplu menü + kilit şeridi + "YENİ" tag + kimlik footer'ı korunur.
// Veri modeli geriye-uyumlu: `groups` (gruplu) ya da düz `items` kabul edilir.

export interface SidebarProps {
  onNavigate?: () => void;
}

export interface NavItem {
  labelKey: string;
  to: string;
  icon: typeof LayoutDashboard;
  // permissions.ts registry'sinden tek bir permission key. Hardcode role check
  // eski pattern'ini kaldırdık (denetim raporu P1 #3.31, karar tutanağı §4).
  requiredPermission: Permission;
  // Doktor menüsünde "Muayene Sırası" satırında canlı kuyruk sayacı gösterilir.
  badge?: 'queue';
}

export interface NavGroup {
  titleKey: string;
  items: NavItem[];
}

// 'amber'/'primary'/'muted' geriye-uyum (mevcut variant'lar kullanıyor); 'live'
// (indigo canlı kuyruk) + 'red' (kritik) v0.4.1'de eklendi.
export type BrandedBadgeTone = 'live' | 'amber' | 'red' | 'primary' | 'muted';

export interface BrandedItem {
  labelKey: string;
  to: string;
  icon: typeof LayoutDashboard;
  // Sayısal rozet — yalnız GERÇEK veri bağlandığında ver (mockup'taki örnek
  // sayıları statik gömme: anti-AI, klinik doğruluk). Veri yoksa rozet yok.
  badge?: number;
  badgeTone?: BrandedBadgeTone;
  // v0.4'te eklenen, henüz tamamlanmamış ekran → "YENİ" etiketi.
  isNew?: boolean;
}

export interface BrandedGroup {
  titleKey: string;
  items: BrandedItem[];
}

/** İsimden baş harf (ünvanları atlar): "Dr. Elif Kaya" → "EK". */
export function initialsFromName(name: string): string {
  const words = name
    .replace(/\b(Dr|Prof|Op|Uzm|Doç)\.?/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '—';
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// Açık-tema (full-sidebar fallback, gruplu olmayan) item sınıfı — geriye uyum.
export const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'group flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
    isActive ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-muted',
  );

// Açık-zemin gövdede rozet tonları (Bölüm 24.2). Bekleyen-sayı = amber kanon.
function brandedBadgeClass(tone: BrandedBadgeTone): string {
  switch (tone) {
    case 'live':
      return 'bg-primary text-primary-foreground';
    case 'amber':
      return 'bg-amber-500 text-white';
    case 'red':
      return 'bg-destructive text-destructive-foreground';
    case 'muted':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-primary/10 text-primary';
  }
}

/**
 * Klinik logosu. logoUrl set ise <img>, hata ya da boşsa AirMed default amblemi.
 *
 * TODO(branding): airmed-logo.png tam logo (amblem + AIRMED yazısı); küçük
 * tile'da yazı zar zor okunur — amblem-only PNG hazırlanınca path'i
 * /airmed-icon.png olarak güncelle.
 */
export function ClinicLogo({ logoUrl, alt }: { logoUrl: string | null; alt: string }) {
  const [errored, setErrored] = useState(false);
  if (!logoUrl || errored) {
    return (
      <img
        src="/airmed-logo.png"
        alt="AirMed"
        className="h-full w-full object-contain p-0.5"
        draggable={false}
      />
    );
  }
  return (
    <img
      key={logoUrl}
      src={logoUrl}
      alt={alt}
      onError={() => setErrored(true)}
      className="h-full w-full object-contain"
    />
  );
}

/** Tek menü satırı — açık zemin (Bölüm 24.2); aktif `bg-primary/10 text-primary`. */
function BrandedNavRow({ item, onNavigate }: { item: BrandedItem; onNavigate?: () => void }) {
  const { t } = useTranslation('common');
  const { labelKey, to, icon: Icon, badge, badgeTone, isNew } = item;
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'focus-ring group flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-100 ease-swift',
          isActive
            ? 'bg-primary/10 font-semibold text-primary'
            : 'text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground',
        )
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} aria-hidden />
      <span className="flex-1 truncate">{t(labelKey)}</span>
      {isNew && (
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-primary">
          {t('nav.newBadge', { defaultValue: 'Yeni' })}
        </span>
      )}
      {!!badge && badge > 0 && (
        <span
          className={cn(
            'inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums',
            brandedBadgeClass(badgeTone ?? 'primary'),
          )}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}

/**
 * Markalı sidebar (doktor + resepsiyon + finans + stok + eczane + diğer roller
 * ortak): tüm yüzey navy→mauve marka gradient'i; klinik header + rol/mod alt
 * başlığı + (opsiyonel) kilit şeridi + gruplu MENÜ + alt kimlik kartı.
 *
 * Veri: `groups` (mockup gruplu) ya da geriye-uyum için düz `items` (tek
 * başlıksız grup). `lockNote` → kilitli mod/nitelik şeridi (örn. Ölçüm, Misafir).
 */
export function BrandedSidebar({
  roleLabel,
  groups,
  items,
  lockNote,
  userName,
  userSubtitle,
  onNavigate,
  showOverview = true,
  overviewTo = '/overview',
}: {
  roleLabel: string;
  groups?: BrandedGroup[];
  items?: BrandedItem[];
  lockNote?: string;
  userName: string;
  userSubtitle?: string;
  onNavigate?: () => void;
  // v0.4.2 G1/#721 — "Genel Bakış" her varyantta pinned-top. Tek noktadan
  // (burada) eklenir → 11 varyant dosyasına ayrı satır eklemeye gerek yok
  // (drift yok, auto-merge dostu). İstisna gerekirse showOverview=false.
  showOverview?: boolean;
  overviewTo?: string;
}) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const clinic = useClinic();
  const clinicName = clinic.name ?? t('app.name');

  // groups verilmezse düz items'ı tek başlıksız gruba sar (geriye uyum).
  const baseGroups: BrandedGroup[] = groups ?? (items ? [{ titleKey: '', items }] : []);
  // "Genel Bakış" başlıksız grup olarak en üste pinlenir.
  const overviewGroup: BrandedGroup = {
    titleKey: '',
    items: [{ labelKey: 'nav.overview', to: overviewTo, icon: LayoutDashboard }],
  };
  const renderGroups: BrandedGroup[] = showOverview ? [overviewGroup, ...baseGroups] : baseGroups;

  return (
    <aside
      className="flex h-full w-full shrink-0 flex-col border-r border-border bg-background lg:w-60"
      aria-label={t('nav.mainMenu')}
    >
      {/* Marka header — Bölüm 24.2: gradient + mesh YALNIZ burada (tek marka
          işareti; #1018 UX turu: 104px → 64px, tipografi sıkılaştı). Gövdenin
          kalanı açık zemin. */}
      <div className={cn('relative h-16 shrink-0 overflow-hidden px-3.5', BRAND_GRADIENT)}>
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{ backgroundImage: BRAND_MESH_BACKGROUND }}
        />
        <div className="relative flex h-full items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/15 ring-1 ring-white/20">
            <ClinicLogo logoUrl={clinic.logoUrl} alt={clinicName} />
          </div>
          <div className="min-w-0">
            <div
              className="truncate text-[13px] font-semibold leading-snug tracking-tight text-white"
              title={clinicName}
            >
              {clinicName}
            </div>
            <div className="truncate text-[10px] font-medium uppercase leading-snug tracking-[0.08em] text-white/65">
              {roleLabel}
            </div>
          </div>
        </div>
      </div>

      {/* Kilitli mod / nitelik şeridi (örn. Ölçüm kiosk, Misafir doktor) — açık
          zemin warning tint (Bölüm 24.1). */}
      {lockNote && (
        <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-[rgba(255,149,0,0.26)] bg-[rgba(255,149,0,0.12)] px-2.5 py-1.5 text-[11px] font-medium text-[#8A4B00]">
          <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <span className="min-w-0">{lockNote}</span>
        </div>
      )}

      {/* Scrollbar gizli (#1018 UX turu — kayarken çubuk görünmesin); klavye/
          tekerlek kaydırması aynen çalışır. */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {renderGroups.map((grp, gi) => (
          <div key={grp.titleKey || `grp-${gi}`} className="pt-2 first:pt-0">
            {grp.titleKey && (
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
                {t(grp.titleKey)}
              </div>
            )}
            <div className="space-y-0.5">
              {grp.items.map((item) => (
                <BrandedNavRow key={item.to} item={item} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Kimlik kartı — açık zemin, ince üst ayraç (#1018 UX turu: kompakt) */}
      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-2.5 px-1">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold tracking-tight text-primary">
            {userName ? initialsFromName(userName) : '—'}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium leading-snug tracking-tight text-foreground">
              {userName || user?.email || t('user.label')}
            </div>
            {userSubtitle && (
              <div className="truncate text-[11px] leading-snug text-muted-foreground">
                {userSubtitle}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
