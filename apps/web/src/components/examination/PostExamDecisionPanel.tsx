import { useState } from 'react';
import { Ban, FileText, FlaskConical, Scissors } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { MeasurementOrderSheet } from '../measurement/MeasurementOrderSheet';
import { SurgeryRefusalDialog } from '../surgery/SurgeryRefusalDialog';
import { cn } from '../../lib/utils';
import { ENCOUNTER_STAGE_META, type EncounterStage } from '../../lib/encounter.constants';
import { ROLES } from '@airmed/contracts';
import { trpc } from '../../lib/trpc';
import { useAuth } from '../../providers/AuthProvider';

// S15 Feature 6 — Muayene-sonrası karar paneli. Hastanın aktif ziyareti
// in_exam / measurement_ready ise doktora "2 opsiyon"u tek yerde sunar:
// Reçete yaz · Ölçüm iste · Ameliyat (satışa). Reçete/ameliyat mevcut
// bölümlere kaydırır; "Ölçüm iste" yeni sheet'i (reuse) açar.

const DECISION_STAGES: readonly EncounterStage[] = ['in_exam', 'measurement_ready'];

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

interface ActiveEncounter {
  id: string;
  stage: EncounterStage;
}

export function PostExamDecisionPanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation(['worklist', 'measurementOrder', 'surgery']);
  const { user } = useAuth();
  const [orderOpen, setOrderOpen] = useState(false);
  const [refuseOpen, setRefuseOpen] = useState(false);

  const isClinician = !!user?.roles.some(
    (r) => r === ROLES.DOKTOR || r === ROLES.YONETICI || r === ROLES.YONETICI_ASISTANI,
  );

  const active = trpc.encounter.activeForPatient.useQuery({ patientId }, { enabled: isClinician });
  const encounter = active.data as ActiveEncounter | null | undefined;

  // S15-PR16 — Hastanın en son planlı ameliyatı (refusal dialog için).
  const surgeries = trpc.surgery.listByPatient.useQuery(
    { patientId },
    { enabled: isClinician && !!encounter },
  );
  const latestPlanned = (
    (surgeries.data ?? []) as Array<{ id: string; status: string; scheduledAt: string }>
  )
    .filter((s) => s.status === 'planned')
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0];

  if (!isClinician || !encounter || !DECISION_STAGES.includes(encounter.stage)) return null;

  const meta = ENCOUNTER_STAGE_META[encounter.stage];
  const StageIcon = meta.icon;

  return (
    <section
      className="rounded-md border border-primary/30 bg-primary/5 p-4"
      data-testid="post-exam-decision"
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs',
            meta.badge,
          )}
        >
          <StageIcon className="h-3.5 w-3.5" aria-hidden />
          {t(`worklist:${meta.labelKey}`)}
        </span>
        <span className="text-sm font-medium">{t('worklist:decision.title')}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          data-testid="decision-prescription"
          onClick={() => scrollToSection('section-prescriptions')}
        >
          <FileText className="mr-1 h-4 w-4" />
          {t('worklist:decision.prescription')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="decision-measurement"
          onClick={() => setOrderOpen(true)}
        >
          <FlaskConical className="mr-1 h-4 w-4" />
          {t('worklist:decision.measurement')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="decision-surgery"
          onClick={() => scrollToSection('section-surgeries')}
        >
          <Scissors className="mr-1 h-4 w-4" />
          {t('worklist:decision.surgery')}
        </Button>
        {latestPlanned && (
          <Button
            variant="outline"
            size="sm"
            data-testid="decision-refuse"
            onClick={() => setRefuseOpen(true)}
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            <Ban className="mr-1 h-4 w-4" />
            {t('surgery:refusal.button')}
          </Button>
        )}
      </div>

      <MeasurementOrderSheet
        open={orderOpen}
        onOpenChange={setOrderOpen}
        patientId={patientId}
        encounterId={encounter.id}
      />
      {latestPlanned && (
        <SurgeryRefusalDialog
          surgeryId={latestPlanned.id}
          open={refuseOpen}
          onOpenChange={setRefuseOpen}
          onSuccess={() => surgeries.refetch()}
        />
      )}
    </section>
  );
}
