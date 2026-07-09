import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../lib/trpc';
import type { DrugItem } from '../../lib/pharmacy.constants';

interface Props {
  patientId: string;
  drugItems: DrugItem[];
}

type Severity = 'contraindicated' | 'severe' | 'moderate' | 'mild';

const SEVERITY_STYLE: Record<Severity, string> = {
  contraindicated: 'border-red-400 bg-red-50 text-red-900',
  severe: 'border-orange-400 bg-orange-50 text-orange-900',
  moderate: 'border-amber-300 bg-amber-50 text-amber-900',
  mild: 'border-blue-300 bg-blue-50 text-blue-900',
};

/**
 * S15-PR4 — Reçete formunda canlı ilaç etkileşim paneli. drugItems veya
 * hasta tıbbi bilgisi değişince debounce sonrası tRPC ile check çağırır,
 * uyarıları severity'e göre renkli kartlarda gösterir. Submit'i bloke
 * etmez (klinik karar doktorda kalır); doktor görüp onaylar.
 */
export function DrugInteractionWarnings({ patientId, drugItems }: Props) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const patient = trpc.patient.findById.useQuery({ id: patientId });

  const drugs = useMemo(
    () => drugItems.map((it) => it.name?.trim() ?? '').filter((s) => s.length > 0),
    [drugItems],
  );

  // Debounce: drugs değişince 500ms bekle, sonra query enable et.
  const [debouncedDrugs, setDebouncedDrugs] = useState<string[]>([]);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedDrugs(drugs), 500);
    return () => clearTimeout(id);
  }, [drugs]);

  const allergies = (patient.data as { allergies?: string[] } | undefined)?.allergies ?? [];
  const anticoagulants =
    (patient.data as { anticoagulantMedications?: string[] } | undefined)
      ?.anticoagulantMedications ?? [];

  const enabled = debouncedDrugs.length > 0;
  const check = trpc.pharmacy.checkInteractions.useQuery(
    {
      drugs: debouncedDrugs,
      allergies,
      anticoagulants,
    },
    { enabled, staleTime: 30_000 },
  );

  if (!enabled) return null;
  if (check.isLoading) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('pharmacy:interactions.checking', { defaultValue: 'Etkileşim kontrol ediliyor…' })}
      </p>
    );
  }
  if (!check.data || check.data.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        <ShieldAlert className="h-3.5 w-3.5" />
        {t('pharmacy:interactions.clean', {
          defaultValue: 'Bilinen kritik etkileşim bulunamadı.',
        })}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground">
        {t('pharmacy:interactions.title', {
          defaultValue: 'İlaç etkileşim uyarıları',
        })}
      </p>
      {check.data.map((w, idx) => {
        const sev = w.severity as Severity;
        return (
          <div
            key={`${w.kind}-${idx}`}
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${SEVERITY_STYLE[sev]}`}
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            <div className="space-y-0.5">
              <p className="font-medium uppercase tracking-wide">
                {t(`pharmacy:interactions.severity.${sev}`, { defaultValue: sev })}
                {' · '}
                {t(`pharmacy:interactions.kind.${w.kind}`, { defaultValue: w.kind })}
              </p>
              <p>
                {w.messageKey
                  ? t(w.messageKey, { ns: 'common', ...w.messageParams, defaultValue: w.message })
                  : w.message}
              </p>
              {w.triggers.length > 0 && (
                <p className="text-[10px] opacity-80">{w.triggers.join(' · ')}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
