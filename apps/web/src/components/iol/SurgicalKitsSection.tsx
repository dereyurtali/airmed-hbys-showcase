import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Package2 } from 'lucide-react';
import { trpc } from '../../lib/trpc';

// S15-PR25 — Surgical Kit availability tracker — IolInventoryPage'e gömülü
// bölüm. Her kit için komponent listesi + IOL model lot bazında availability.

// Delta audit A-1: `trpc as unknown as` cast'i kaldırıldı; gerçek hook'lar
// kullanılır. Render mantığı için tRPC dönüşü shape'i: KitRow zaten backend'in
// `iol.kitAvailability` çıktısı (KitAvailability interface API tarafında).
// Delta audit C-19: `kitsBuildable === null` = sınırsız; `availableAcrossLots
// === null` = stok takip edilmiyor.

export function SurgicalKitsSection() {
  const { t } = useTranslation(['iol', 'common']);
  const query = trpc.iol.kitAvailability.useQuery(undefined, {
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });

  const rows = query.data ?? [];

  if (query.isLoading || rows.length === 0) return null;

  return (
    <section className="rounded-lg border bg-card p-4" data-testid="surgical-kits-section">
      <header className="mb-3 flex items-center gap-2">
        <Package2 className="h-4 w-4" />
        <h2 className="text-base font-semibold">
          {t('iol:kits.title', { defaultValue: 'Cerrahi Kit Uygunluğu' })}
        </h2>
        <span className="ml-auto text-xs text-muted-foreground">{rows.length} kit</span>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((kit) => (
          <div
            key={kit.kitId}
            className={
              'rounded-lg border p-3 ' +
              (kit.isFullyAvailable
                ? 'border-success-border bg-success-bg'
                : 'border-warning-border bg-warning-bg')
            }
            data-testid={`kit-${kit.kitId}`}
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">
                  {kit.name}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{kit.code}</span>
                </div>
                <div className="text-xs text-muted-foreground">{kit.surgeryType}</div>
              </div>
              <div className="text-right">
                {kit.isFullyAvailable ? (
                  <CheckCircle2 className="ml-auto h-4 w-4 text-success-foreground" />
                ) : (
                  <AlertTriangle className="ml-auto h-4 w-4 text-warning-foreground" />
                )}
                <div className="text-xs font-medium">
                  {kit.kitsBuildable === null ? '∞' : kit.kitsBuildable} adet hazırlanabilir
                </div>
              </div>
            </div>
            <ul className="mt-2 space-y-0.5 text-xs">
              {kit.components.map((c, idx) => (
                <li key={idx} className="flex justify-between">
                  <span className={c.isRequired ? 'font-medium' : 'text-muted-foreground'}>
                    {c.iolModelName ?? c.componentName ?? '?'}
                    {c.isRequired ? '' : ' (opsiyonel)'}× {c.requiredQty}
                  </span>
                  <span
                    className={
                      c.isSatisfied
                        ? 'text-success-foreground tabular-nums'
                        : 'text-critical-foreground tabular-nums font-semibold'
                    }
                  >
                    {c.iolModelId && c.availableAcrossLots !== null
                      ? `${c.availableAcrossLots} mevcut`
                      : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
