import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, CheckCircle2 } from 'lucide-react';
import { OverviewShell, OverviewStatCard } from '../../components/overview';
import { Button } from '../../components/ui/button';
import { trpc } from '../../lib/trpc';

/**
 * Ölçüm Kiosk Genel Bakış — kilitli istasyon (hemşire Ölçüm modu / olcum_hemsiresi).
 * v0.4.2 R2 (#724). Foolproof: 2 büyük StatCard (Bekleyen / Tamamlanan) + tam-genişlik
 * "Sıradakini Al". Dışarı navigasyon yok (kiosk); Cmd+K paleti zaten kapalı (G3).
 */
export function MeasurementKioskOverview() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();

  const pending = trpc.measurementOrder.listForUnit.useQuery({}, { refetchInterval: 15_000 });
  const completed = trpc.measurementOrder.listForUnit.useQuery(
    { completedToday: true },
    { refetchInterval: 30_000 },
  );
  const pendingCount = pending.data?.length ?? 0;
  const completedCount = completed.data?.length ?? 0;

  return (
    <OverviewShell title={t('overview.kiosk.title')}>
      <section className="grid gap-4 sm:grid-cols-2">
        <OverviewStatCard
          icon={Activity}
          tint="sky"
          value={pending.isLoading ? '—' : pendingCount}
          label={t('overview.kiosk.pending')}
          to="/measurement-queue"
        />
        <OverviewStatCard
          icon={CheckCircle2}
          tint="emerald"
          value={completed.isLoading ? '—' : completedCount}
          label={t('overview.kiosk.completed')}
          to="/measurement-completed"
        />
      </section>

      <Button
        size="lg"
        className="h-16 w-full text-base"
        disabled={pendingCount === 0}
        onClick={() => navigate('/measurement-queue')}
        data-testid="kiosk-take-next"
      >
        {t('overview.kiosk.takeNext')}
      </Button>
    </OverviewShell>
  );
}
