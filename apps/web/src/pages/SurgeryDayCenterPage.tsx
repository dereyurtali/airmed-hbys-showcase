import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Barcode,
  CalendarDays,
  CheckCircle2,
  Circle,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
import { PageHeader } from '../components/layout/PageHeader';
import { LensRegisterDialog } from '../components/surgery/LensRegisterDialog';
import { MarkCompletedDialog } from '../components/surgery/MarkCompletedDialog';
import { SafetyChecklistPanel } from '../components/surgery/SafetyChecklistPanel';
import { trpc } from '../lib/trpc';
import { localeToIntl } from '../lib/i18n-format';
import { useLocale } from '../providers/LocaleProvider';
import { usePermission } from '../hooks/usePermission';
import { DataErrorState } from '../components/common/DataErrorState';

interface SurgeryRow {
  id: string;
  type: string;
  status: 'planned' | 'performed' | 'cancelled' | 'postponed';
  scheduledAt: string;
  performedAt: string | null;
  complicationFlag: boolean;
  eyeSide: 'od' | 'os' | 'ou' | null;
  patient: { id: string; mrn: string; firstName: string; lastName: string };
  doctor: { id: string; name: string };
  lensImplantLotId: string | null;
  lensSerialNumber: string | null;
  safetyFullyComplete: boolean;
  // R1 (#723) — "Tamamlamak için eksikler" paneli: imzalı onam var mı.
  consentSigned: boolean;
}

/**
 * S15-PR9 — Ameliyat Günü Merkezi. Bugünkü ameliyatların pipeline görünümü:
 * scheduledAt = bugün → her satır bir pipeline (planned → safety checklist
 * → lens kayıt → markCompleted). Safety checklist + lens entegrasyonu mevcut
 * componentlerden (PR3 + B1) reuse. PR sırasındaki tek yeni sayfa.
 */
export function SurgeryDayCenterPage() {
  const { t } = useTranslation(['surgery', 'safety', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale);

  const [safetyDialog, setSafetyDialog] = useState<string | null>(null);
  const [lensDialog, setLensDialog] = useState<string | null>(null);
  const [completeDialog, setCompleteDialog] = useState<string | null>(null);
  const utils = trpc.useUtils();

  // R5 (#727) — finalize aksiyonları yalnız doktorda; asistan/hemşire/yönetici
  // ekrana erişir (page:surgeryDay) ama Lens kaydı + Tamamla butonları GİZLİ
  // (disabled değil — "rol yapamıyorsa gizli" rayı). Prereq eksikse buton zaten
  // doktorda disabled+tooltip kalır.
  const canRegisterLens = usePermission('action:surgery.registerLens');
  const canComplete = usePermission('action:surgery.markCompleted');

  // Bugünkü tüm cerrahiler — backend list endpoint'i date filter destekliyor.
  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const endOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }, []);

  const list = trpc.surgery.list.useQuery({
    dateFrom: startOfToday,
    dateTo: endOfToday,
    page: 1,
    pageSize: 50,
  });

  const surgeries = (list.data?.items ?? []) as unknown as SurgeryRow[];

  const pipelineStage = (
    s: SurgeryRow,
  ): 'planned' | 'lens_pending' | 'ready' | 'done' | 'cancelled' => {
    if (s.status === 'cancelled' || s.status === 'postponed') return 'cancelled';
    if (s.status === 'performed') return 'done';
    if (!s.lensImplantLotId && !s.lensSerialNumber) return 'lens_pending';
    return 'ready';
  };

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('surgery:day.title')}
        description={t('surgery:day.description', {
          defaultValue:
            'Bugünkü tüm cerrahilerin pipeline görünümü: güvenlik kontrolü, lens kaydı, post-op randevu zinciri.',
        })}
      />

      {list.isError && !list.data ? (
        <DataErrorState onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : surgeries.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
          {t('surgery:day.empty')}
        </div>
      ) : (
        <ul className="space-y-3">
          {surgeries.map((s) => {
            const stage = pipelineStage(s);
            return (
              <li key={s.id} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <UserIcon className="h-4 w-4 text-muted-foreground" />
                      {s.patient ? (
                        <Link to={`/patients/${s.patient.id}`} className="hover:underline">
                          {s.patient.firstName} {s.patient.lastName}
                        </Link>
                      ) : (
                        <span>—</span>
                      )}
                      {s.patient && (
                        <span className="text-xs text-muted-foreground">({s.patient.mrn})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CalendarDays className="h-3 w-3" />
                      {fmtTime(s.scheduledAt)} · {s.type} · Dr. {s.doctor?.name ?? '—'}
                      {s.eyeSide && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">
                          {s.eyeSide}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StageBadge stage={stage} />
                    {s.status === 'planned' &&
                      (s.safetyFullyComplete ? (
                        <Badge variant="success">
                          <ShieldCheck className="h-3 w-3" />
                          {t('surgery:day.safetyComplete')}
                        </Badge>
                      ) : (
                        <Badge variant="critical">
                          <ShieldAlert className="h-3 w-3" />
                          {t('surgery:day.safetyPending')}
                        </Badge>
                      ))}
                    {s.complicationFlag && (
                      <Badge variant="warning">
                        <AlertTriangle className="h-3 w-3" />
                        {t('surgery:day.complication')}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* R1 (#723) — "Tamamlamak için eksikler" tek-bakış ön-koşul paneli.
                    Doktor "Tamamlandı"ya basmadan önce neyin eksik olduğunu görür
                    (400 sürprizi yerine). Onam + checklist hard gate; lens bilgilendirme. */}
                {s.status === 'planned' && (
                  <div className="mt-3 grid grid-cols-1 gap-1.5 rounded-lg bg-muted/40 p-2 sm:grid-cols-3">
                    <ReqItem ok={s.safetyFullyComplete} label={t('surgery:day.req.checklist')} />
                    <ReqItem ok={s.consentSigned} label={t('surgery:day.req.consent')} />
                    <ReqItem
                      ok={!!(s.lensImplantLotId || s.lensSerialNumber)}
                      label={t('surgery:day.req.lens')}
                    />
                  </div>
                )}

                {/* Pipeline action butonları */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSafetyDialog(s.id)}>
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                    {t('safety:title')}
                  </Button>
                  {s.status === 'planned' && canRegisterLens && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setLensDialog(s.id)}
                      data-testid={`lens-register-${s.id}`}
                    >
                      <Barcode className="mr-1 h-3.5 w-3.5" />
                      {t('surgery:day.registerLens')}
                    </Button>
                  )}
                  {s.status === 'planned' &&
                    canComplete &&
                    (() => {
                      // R1 (#723) — Tamamla kapısı: checklist + onam (ikisi de backend
                      // markCompleted hard gate). Eksik(ler) tooltip'te listelenir.
                      const missing: string[] = [];
                      if (!s.safetyFullyComplete) missing.push(t('surgery:day.req.checklist'));
                      if (!s.consentSigned) missing.push(t('surgery:day.req.consent'));
                      const blocked = missing.length > 0;
                      return (
                        <span
                          title={
                            blocked
                              ? t('surgery:day.completeGateTooltip', {
                                  missing: missing.join(', '),
                                  defaultValue: `Tamamlamak için eksik: ${missing.join(', ')}`,
                                })
                              : undefined
                          }
                        >
                          <Button
                            size="sm"
                            disabled={blocked}
                            onClick={() => setCompleteDialog(s.id)}
                            data-testid={`complete-${s.id}`}
                          >
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            {t('surgery:day.complete')}
                          </Button>
                        </span>
                      );
                    })()}
                  {s.patient && (
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/patients/${s.patient.id}`}>{t('surgery:day.goToPatient')}</Link>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {safetyDialog && (
        <Dialog open={!!safetyDialog} onOpenChange={(o) => !o && setSafetyDialog(null)}>
          <DialogContent className="max-w-2xl">
            <DialogTitle>{t('safety:title')}</DialogTitle>
            <SafetyChecklistPanel surgeryId={safetyDialog} />
          </DialogContent>
        </Dialog>
      )}

      {lensDialog && (
        <LensRegisterDialog
          surgeryId={lensDialog}
          open={!!lensDialog}
          onOpenChange={(o) => !o && setLensDialog(null)}
          onSuccess={() => void list.refetch()}
        />
      )}

      {completeDialog && (
        <MarkCompletedDialog
          surgeryId={completeDialog}
          open={!!completeDialog}
          onOpenChange={(o) => !o && setCompleteDialog(null)}
          onSuccess={() => {
            void list.refetch();
            void utils.invalidate();
          }}
        />
      )}
    </div>
  );
}

// R1 (#723) — "eksikler" panelinde tek ön-koşul satırı (✓ yeşil / ✗ kırmızı).
function ReqItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${
        ok ? 'text-success-foreground' : 'text-critical-foreground'
      }`}
    >
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      {label}
    </span>
  );
}

function StageBadge({
  stage,
}: {
  stage: 'planned' | 'lens_pending' | 'ready' | 'done' | 'cancelled';
}) {
  const { t } = useTranslation(['surgery']);
  const STYLES: Record<
    string,
    { variant: 'neutral' | 'warning' | 'info' | 'success'; icon: typeof Circle }
  > = {
    planned: { variant: 'neutral', icon: Circle },
    lens_pending: { variant: 'warning', icon: Circle },
    ready: { variant: 'info', icon: Circle },
    done: { variant: 'success', icon: CheckCircle2 },
    cancelled: { variant: 'neutral', icon: Circle },
  };
  const s = STYLES[stage];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant}>
      <Icon className="h-3 w-3" />
      {t(`surgery:day.stage.${stage}`, { defaultValue: stage })}
    </Badge>
  );
}
