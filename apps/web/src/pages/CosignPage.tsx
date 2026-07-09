import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, ExternalLink, ShieldAlert, X } from 'lucide-react';
import { useLocale } from '../providers/LocaleProvider';
import { formatDateTime } from '../lib/i18n-format';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
import { confirmIfDirty } from '../hooks/useUnsavedWarning';
import { useConfirm } from '../hooks/useConfirm';
import { trpc } from '../lib/trpc';
import { mapTrpcError } from '../lib/trpc-error';

// S15-PR23 — Doktor co-sign sayfası. Hemşire adı altında yapılan işlemleri
// listeler; low-risk entity'ler (measurement, photo, examination, measurementOrder)
// bulk onaylanabilir; high-risk (prescription, surgery, refund, ...) tek-tek.
// #389 — her satır hasta (ad+MRN, detay linki) + entity özeti (ilaç/ameliyat) gösterir.

interface CosignRow {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  user: { id: string; name: string } | null;
  nurseSession: { id: string } | null;
  patient: { id: string; name: string; mrn: string } | null;
  summary: string | null;
  // R1 (#723) — audit middleware'in yakaladığı alan-bazlı değişiklik (before→after).
  diff: { field: string; before: unknown; after: unknown }[] | null;
  risk?: 'high' | 'low';
}

const LOW_RISK = ['measurement', 'measurementOrder', 'photo', 'examination'];
const LOW_RISK_VISIBLE = 20;

// Delta audit A-1: `trpc as unknown as` cast'i kaldırıldı; gerçek hook'lar.

export function CosignPage() {
  const { t } = useTranslation(['cosign', 'common']);
  const { locale } = useLocale();
  const { confirm } = useConfirm();
  const [rejecting, setRejecting] = useState<CosignRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const utils = trpc.useUtils();
  const listQuery = trpc.cosign.listPending.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const invalidate = () => utils.cosign.listPending.invalidate();

  const approveMutation = trpc.cosign.approve.useMutation();
  const bulkMutation = trpc.cosign.bulkApprove.useMutation();
  const rejectMutation = trpc.cosign.reject.useMutation();

  // Delta audit A-1: tRPC dönüşü AppRouter type depth limit'i aştığı için
  // (denetim P1 #3.25) local interface'e dar cast. Hook çağrıları gerçek tip.
  const rows = (listQuery.data ?? []) as CosignRow[];
  const lowRiskRows = rows.filter((r) => r.entityType && LOW_RISK.includes(r.entityType));
  const highRiskRows = rows.filter((r) => r.entityType && !LOW_RISK.includes(r.entityType));
  const hiddenLowRisk = Math.max(0, lowRiskRows.length - LOW_RISK_VISIBLE);

  // #389 — action/entityType i18n; tanımsızsa ham değere düşer.
  const entityLabel = (type: string | null) =>
    type ? t(`cosign:entityType.${type}`, { defaultValue: type }) : '—';
  const actionLabel = (action: string) => t(`cosign:action.${action}`, { defaultValue: action });

  return (
    <div className="space-y-6">
      <PageHeader title={t('cosign:page.title')} description={t('cosign:page.description')} />

      {lowRiskRows.length > 0 && (
        <section className="rounded-lg border bg-card p-4">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {t('cosign:section.lowRisk', { count: lowRiskRows.length })}
            </h2>
            <Button
              size="sm"
              disabled={bulkMutation.isPending}
              onClick={async () => {
                // #433 — "kör toplu onay" düzeltmesi: (1) beforeAt = yüklenmiş en
                // yeni kaydın createdAt'i; tıklama-anı now() yerine bu kullanılır
                // ki son fetch'ten SONRA gelen (ekranda hiç görünmeyen) kayıtlar
                // sweep edilmesin. (2) toplam sayıyı (görünen + gizli) gösteren
                // teyit — kullanıcı kapsamı bilinçli onaylar.
                const newestAt = lowRiskRows.reduce(
                  (max, r) => (r.createdAt > max ? r.createdAt : max),
                  lowRiskRows[0].createdAt,
                );
                if (
                  !(await confirm({
                    message: t('cosign:confirmBulk', { count: lowRiskRows.length }),
                  }))
                )
                  return;
                bulkMutation.mutate(
                  {
                    entityTypes: LOW_RISK,
                    beforeAt: newestAt,
                  },
                  {
                    onSuccess: (data) => {
                      toast.success(t('cosign:toast.bulkApproved', { count: data.approvedCount }));
                      void invalidate();
                    },
                    onError: (err) => toast.error(mapTrpcError(err, t)),
                  },
                );
              }}
              data-testid="bulk-approve-low-risk"
            >
              <Check className="mr-1 h-4 w-4" />
              {t('cosign:actions.bulkApprove')}
            </Button>
          </header>
          <ul className="space-y-1 text-xs">
            {lowRiskRows.slice(0, LOW_RISK_VISIBLE).map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-2 border-b py-1.5">
                <div className="min-w-0">
                  <PatientLink patient={r.patient} fallback={t('cosign:noPatient')} />
                  <div className="text-muted-foreground">
                    {entityLabel(r.entityType)}
                    {r.summary ? ` · ${r.summary}` : ''} · {actionLabel(r.action)} ·{' '}
                    {r.user?.name ?? '?'}
                    {r.diff && r.diff.length > 0 && (
                      <span className="ml-1 text-primary">
                        · {t('cosign:diff.changeCount', { count: r.diff.length })}
                      </span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-muted-foreground">
                  {formatDateTime(r.createdAt, locale)}
                </span>
              </li>
            ))}
          </ul>
          {/* #389 — toplu onay görünen 20'yi değil TÜM low-risk'i kapsar; gizli sayacı uyar. */}
          {hiddenLowRisk > 0 && (
            <p className="mt-2 text-xs font-medium text-warning-foreground">
              {t('cosign:hiddenWarning', { shown: LOW_RISK_VISIBLE, hidden: hiddenLowRisk })}
            </p>
          )}
        </section>
      )}

      {highRiskRows.length > 0 && (
        <section className="rounded-lg border border-warning-border bg-warning-bg p-4">
          <header className="mb-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning-foreground" />
            <h2 className="text-sm font-semibold">
              {t('cosign:section.highRisk', { count: highRiskRows.length })}
            </h2>
          </header>
          <ul className="space-y-2">
            {highRiskRows.map((r) => (
              <li
                key={r.id}
                className="flex items-start justify-between gap-3 rounded-lg border bg-background p-2 text-sm"
                data-testid={`cosign-row-${r.id}`}
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    <PatientLink patient={r.patient} fallback={t('cosign:noPatient')} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {entityLabel(r.entityType)}
                    {r.summary ? ` · ${r.summary}` : ''} · {actionLabel(r.action)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.user?.name ?? '?'} · {formatDateTime(r.createdAt, locale)}
                  </div>
                  {/* R1 (#723) — alan-bazlı değişiklik (before→after). */}
                  <CosignDiff diff={r.diff} />
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={approveMutation.isPending}
                    onClick={() =>
                      approveMutation.mutate(
                        { auditLogId: r.id },
                        {
                          onSuccess: () => void invalidate(),
                          onError: (err) => toast.error(mapTrpcError(err, t)),
                        },
                      )
                    }
                    data-testid={`approve-${r.id}`}
                    aria-label={t('cosign:actions.approveAria')}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRejecting(r);
                      setRejectReason('');
                    }}
                    data-testid={`reject-${r.id}`}
                    aria-label={t('cosign:actions.rejectAria')}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length === 0 && !listQuery.isLoading && <EmptyState title={t('cosign:empty')} />}

      <Dialog
        open={rejecting !== null}
        onOpenChange={(next) => {
          if (next || rejectMutation.isPending) return;
          if (!confirmIfDirty(rejectReason !== '', t('common:forms.unsavedConfirm'))) return;
          setRejecting(null);
        }}
      >
        <DialogContent>
          <DialogTitle className="mb-3 text-base">{t('cosign:rejectDialog.title')}</DialogTitle>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!rejecting || rejectReason.trim().length < 10) return;
              rejectMutation.mutate(
                {
                  auditLogId: rejecting.id,
                  reason: rejectReason.trim(),
                },
                {
                  onSuccess: () => {
                    setRejecting(null);
                    setRejectReason('');
                    void invalidate();
                  },
                  onError: (err) => toast.error(mapTrpcError(err, t)),
                },
              );
            }}
          >
            <textarea
              className="focus-ring min-h-[80px] w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
              placeholder={t('cosign:rejectDialog.placeholder')}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={500}
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRejecting(null)}>
                {t('cosign:rejectDialog.cancel')}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={rejectReason.trim().length < 10 || rejectMutation.isPending}
              >
                {t('cosign:rejectDialog.confirm')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// #389 — hasta adı + MRN + detay linki. Hasta çözülemezse fallback metin.
// R1 (#723) — Co-sign alan-bazlı diff: hemşirenin doktor adına değiştirdiği her
// alan before→after. Doktor onaylamadan ne değiştiğini görür (toplu-imza yok).
function CosignDiff({ diff }: { diff: CosignRow['diff'] }) {
  const { t } = useTranslation('cosign');
  if (!diff || diff.length === 0) return null;
  const fmt = (v: unknown): string => {
    if (v == null || v === '') return '∅';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  return (
    <div className="mt-1.5 space-y-0.5 rounded border-l-2 border-primary/40 bg-muted/40 px-2 py-1 text-xs">
      {diff.map((c) => (
        <div key={c.field} className="flex flex-wrap items-baseline gap-1">
          <span className="font-medium">
            {t(`diff.field.${c.field}`, { defaultValue: c.field })}:
          </span>
          <span className="text-critical-foreground line-through">{fmt(c.before)}</span>
          <span className="text-muted-foreground" aria-hidden>
            →
          </span>
          <span className="text-success-foreground">{fmt(c.after)}</span>
        </div>
      ))}
    </div>
  );
}

function PatientLink({ patient, fallback }: { patient: CosignRow['patient']; fallback: string }) {
  if (!patient) return <span className="text-muted-foreground">{fallback}</span>;
  return (
    <Link
      to={`/patients/${patient.id}`}
      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
    >
      {patient.name}
      <span className="font-normal text-muted-foreground">· {patient.mrn}</span>
      <ExternalLink className="h-3 w-3" aria-hidden />
    </Link>
  );
}
