import { Link } from 'react-router-dom';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { useAuth } from '../../providers/AuthProvider';
import { hasPermission, type Permission } from '@airmed/contracts';

// AnalysisHub + SettingsHub paylaşılan kart-grid yüzeyi.
// AdminOverview StatCard yüzey dili (rounded-xl border bg-background +
// rounded-xl tint pill + hover'da çerçeve primary'ye yaklaşır + shadow-sm).
// Kod tekrarı yok: her hub yalnızca kart listesi tanımlar.

export interface HubCard {
  to: string;
  icon: LucideIcon;
  tint: keyof typeof TINT_CLASSES;
  title: string;
  description: string;
  // R5 (#727) — kart yalnız bu yetki varsa görünür. Yetkisiz rolde kart
  // GİZLİ (disabled değil) → hedef route'a tıklayınca permission-denied'a
  // düşmez. `required` verilmeyen kart her zaman görünür (geriye uyumlu).
  required?: Permission;
}

const TINT_CLASSES = {
  sky: 'bg-sky-50 text-sky-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  violet: 'bg-violet-50 text-violet-600',
  slate: 'bg-slate-50 text-slate-600',
} as const;

interface HubCardGridProps {
  title: string;
  description: string;
  cards: HubCard[];
}

export function HubCardGrid({ title, description, cards }: HubCardGridProps) {
  const { user } = useAuth();
  const visibleCards = cards.filter(
    (c) => !c.required || (!!user && hasPermission(user.roles, c.required, user.effectivePerms)),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleCards.map(({ to, icon: Icon, tint, title: cardTitle, description: cardDesc }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-xl border bg-background p-5 transition-all hover:border-primary/40 hover:shadow-sm"
          >
            <div className="flex items-start justify-between">
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-xl ${TINT_CLASSES[tint]}`}
              >
                <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
              </span>
              <ArrowRight
                className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary"
                strokeWidth={1.5}
                aria-hidden
              />
            </div>
            <h3 className="mt-4 text-base font-semibold tracking-tight">{cardTitle}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{cardDesc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
