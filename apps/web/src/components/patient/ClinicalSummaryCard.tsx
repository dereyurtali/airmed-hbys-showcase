import { useTranslation } from 'react-i18next';
import { trpc } from '../../lib/trpc';
import { Badge } from '../ui/badge';

interface ClinicalSummaryCardProps {
  patientId: string;
}

const ALLERGY_TAG_KEYS = new Set([
  'allergy',
  'drug_allergy',
  'latex_allergy',
  'iodine_allergy',
  'penicillin_allergy',
]);

const SYSTEMIC_TAG_KEYS = new Set(['diabetes', 'hypertension', 'cardiac', 'kidney', 'chronic']);

/**
 * S6 — Klinik özet kartı (karar tutanağı §5).
 *
 * Tüm rollerde görünür (view:patient.clinical_summary_card → herkes).
 * Resepsiyon hastayı çağırırken "ne işlem için geliyor" görsün — detay
 * timeline'lar (muayene/lab/cerrahi) tıbbi rollerle sınırlı, ama özet
 * kart minimum klinik bilgiyi paylaşır:
 *   - Alerji rozeti (varsa kırmızı)
 *   - Sistemik tag'ler (DM/HT vb.)
 *   - Birincil doktor (PatientDoctor.isPrimary=true)
 *
 * Şu an verileri patient.findById + patient.primaryDoctor (yeni endpoint)
 * üzerinden gelir; ek backend lazım değil — frontend computed.
 */
export function ClinicalSummaryCard({ patientId }: ClinicalSummaryCardProps) {
  const { t } = useTranslation(['patient', 'common']);
  const patient = trpc.patient.findById.useQuery({ id: patientId });

  if (patient.isLoading || !patient.data) return null;

  const tags = (patient.data as { tags?: string[] }).tags ?? [];
  const allergies = tags.filter((tg) => ALLERGY_TAG_KEYS.has(tg));
  const systemic = tags.filter((tg) => SYSTEMIC_TAG_KEYS.has(tg));

  const hasContent = allergies.length > 0 || systemic.length > 0;
  if (!hasContent) {
    return (
      <section className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        {t('patient:summary.empty', { defaultValue: 'Klinik özet bilgisi yok' })}
      </section>
    );
  }

  return (
    <section
      className="rounded-md border bg-card px-4 py-3 space-y-2"
      data-testid="patient-clinical-summary"
    >
      <h3 className="text-sm font-semibold">
        {t('patient:summary.title', { defaultValue: 'Klinik Özet' })}
      </h3>
      <div className="flex flex-wrap gap-2">
        {allergies.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              {t('patient:summary.allergies', { defaultValue: 'Alerji' })}:
            </span>
            {allergies.map((a) => (
              <Badge key={a} className="bg-destructive text-destructive-foreground text-xs">
                {t(`patient:tags.${a}`, { defaultValue: a })}
              </Badge>
            ))}
          </div>
        )}
        {systemic.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              {t('patient:summary.systemic', { defaultValue: 'Sistemik' })}:
            </span>
            {systemic.map((s) => (
              <Badge key={s} variant="secondary" className="text-xs">
                {t(`patient:tags.${s}`, { defaultValue: s })}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
