import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, GraduationCap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { useAuth } from '../../providers/AuthProvider';
import { getSidebarVariant } from '../../lib/sidebar-variant';
import { guideVariantKey, resolveGuideScreenKey } from '../../lib/guide-resolver';

// #425 + #1072 — Ekran-duyarlı kullanım kılavuzu. İki sekme:
//   "Bu Ekran": bulunulan rota + rol varyantına göre canlı kullanım kılavuzu
//               (guide namespace; resolver route→screenKey + variant→guideKey).
//   "İlk Gün":  #425 rol-bazlı ilk-gün checklist'i (localStorage ilerleme +
//               ilk-oturum otomatik açılış — davranış birebir korunur).

const ROLE_PRIORITY = ['resepsiyon', 'olcum_hemsiresi', 'doktor', 'yonetici'] as const;

function primaryRole(roles: string[]): string {
  for (const r of ROLE_PRIORITY) if (roles.includes(r)) return r;
  if (roles.includes('yonetici_asistani')) return 'yonetici';
  return 'default';
}

function storageKey(role: string): string {
  return `airmed.onboarding.${role}`;
}

type ScreenTask = { title: string; steps: string[] };
type ScreenGuide = {
  title: string;
  purpose?: string;
  layout?: string;
  tasks?: ScreenTask[];
  // #1073 — rol-özel not (ör. misafir doktorda dar kapsam uyarısı).
  note?: string;
};

type Tab = 'screen' | 'firstDay';

export function OnboardingGuide() {
  const { t } = useTranslation(['common', 'guide']);
  const { user } = useAuth();
  const location = useLocation();
  const roles = useMemo(() => user?.roles ?? [], [user]);
  const role = useMemo(() => primaryRole(roles), [roles]);
  const variant = useMemo(() => getSidebarVariant(roles, user?.mode), [roles, user?.mode]);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('screen');

  // ---- "Bu Ekran" içeriği (canlı; rota değişince değişir) ----
  const screenGuide = useMemo<ScreenGuide | null>(() => {
    const screenKey = resolveGuideScreenKey(location.pathname);
    if (!screenKey) return null;
    const vKey = guideVariantKey(variant);
    // Lookup sırası: guide.<variant>.<screen> → guide.default.<screen> → null.
    for (const ns of [vKey, 'default']) {
      const g = t(`guide:${ns}.${screenKey}`, {
        returnObjects: true,
        defaultValue: null,
      }) as ScreenGuide | null;
      if (g && typeof g === 'object' && g.title) return g;
    }
    return null;
  }, [t, variant, location.pathname]);

  // ---- "İlk Gün" checklist (#425 davranışı) ----
  const stepList = useMemo(() => {
    const obj = t(`common:onboarding.roles.${role}.steps`, {
      returnObjects: true,
      defaultValue: {},
    });
    return obj && typeof obj === 'object' ? (Object.values(obj) as string[]) : [];
  }, [t, role]);

  const [checked, setChecked] = useState<boolean[]>([]);

  useEffect(() => {
    if (!user || stepList.length === 0) return;
    let saved: boolean[] = [];
    try {
      const raw = localStorage.getItem(storageKey(role));
      if (raw) saved = JSON.parse(raw) as boolean[];
    } catch {
      saved = [];
    }
    setChecked(stepList.map((_, i) => saved[i] ?? false));
    // İlk kez gören kullanıcıya otomatik aç (kayıt yoksa).
    if (localStorage.getItem(storageKey(role)) === null) setOpen(true);
  }, [user, role, stepList.length]);

  const persist = (next: boolean[]) => {
    setChecked(next);
    try {
      localStorage.setItem(storageKey(role), JSON.stringify(next));
    } catch {
      // localStorage erişilemezse sessiz geç (kılavuz kritik değil).
    }
  };
  const toggle = (i: number) => persist(checked.map((c, idx) => (idx === i ? !c : c)));
  const doneCount = checked.filter(Boolean).length;
  const allDone = stepList.length > 0 && doneCount === stepList.length;

  if (!user) return null;
  const hasFirstDay = stepList.length > 0;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          setTab('screen');
          setOpen(true);
        }}
        aria-label={t('common:onboarding.helpButton')}
        title={t('common:onboarding.helpButton')}
      >
        <GraduationCap className="h-5 w-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" aria-hidden />
            {t('common:onboarding.title')}
          </DialogTitle>
          <DialogDescription>{t('common:onboarding.intro')}</DialogDescription>

          {/* Sekme başlıkları — 44px dokunma hedefi */}
          <div className="mt-2 flex gap-1 border-b" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'screen'}
              onClick={() => setTab('screen')}
              className={cn(
                'min-h-[44px] px-3 text-sm font-medium',
                tab === 'screen'
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {t('guide:meta.thisScreenTab')}
            </button>
            {hasFirstDay && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'firstDay'}
                onClick={() => setTab('firstDay')}
                className={cn(
                  'min-h-[44px] px-3 text-sm font-medium',
                  tab === 'firstDay'
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {t('guide:meta.firstDayTab')}
              </button>
            )}
          </div>

          {tab === 'screen' ? (
            <div className="mt-3 space-y-3 text-sm">
              {screenGuide ? (
                <>
                  <h3 className="text-base font-semibold">{screenGuide.title}</h3>
                  {screenGuide.purpose && (
                    <p>
                      <span className="font-medium text-muted-foreground">
                        {t('guide:meta.purposeLabel')}:{' '}
                      </span>
                      {screenGuide.purpose}
                    </p>
                  )}
                  {screenGuide.layout && (
                    <p>
                      <span className="font-medium text-muted-foreground">
                        {t('guide:meta.layoutLabel')}:{' '}
                      </span>
                      {screenGuide.layout}
                    </p>
                  )}
                  {screenGuide.tasks && screenGuide.tasks.length > 0 && (
                    <div className="space-y-2">
                      <p className="font-medium text-muted-foreground">
                        {t('guide:meta.tasksLabel')}
                      </p>
                      {screenGuide.tasks.map((task, ti) => (
                        <div key={ti} className="rounded-md border p-2">
                          <p className="font-medium">{task.title}</p>
                          <ol className="ml-4 list-decimal space-y-0.5 text-muted-foreground">
                            {task.steps.map((step, si) => (
                              <li key={si}>{step}</li>
                            ))}
                          </ol>
                        </div>
                      ))}
                    </div>
                  )}
                  {screenGuide.note && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                      {screenGuide.note}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">{t('guide:meta.comingSoon')}</p>
              )}
            </div>
          ) : (
            <>
              <ul className="mt-3 space-y-2">
                {stepList.map((step, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => toggle(i)}
                      aria-pressed={checked[i] ?? false}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                        checked[i]
                          ? 'border-emerald-300 bg-emerald-50 text-muted-foreground line-through'
                          : 'hover:bg-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                          checked[i]
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-muted-foreground/40',
                        )}
                        aria-hidden
                      >
                        {checked[i] ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <span className="text-xs">{i + 1}</span>
                        )}
                      </span>
                      <span className="flex-1">{step}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {allDone
                    ? t('common:onboarding.allDone')
                    : t('common:onboarding.progress', { done: doneCount, total: stepList.length })}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('common:onboarding.trainingNote')}
              </p>
            </>
          )}

          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
              {t('common:onboarding.dismiss')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
