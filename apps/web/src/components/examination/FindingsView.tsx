import { useTranslation } from 'react-i18next';
import { FINDINGS_FIELDS, type ExaminationFindings } from '../../lib/examination.constants';

// #388 — Muayene bulgularını (OD/OS VA, ön segment, fundus) salt-okunur göster.
// Hem ExaminationTimeline hem doktor worklist'i kullanır; 24h düzenleme penceresi
// kapansa da bulgular okunur kalır. Boş alan atlanır; hiç değer yoksa null döner.
export function FindingsView({
  findings,
  className,
}: {
  findings: ExaminationFindings | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation('examination');
  if (!findings) return null;
  const rows = FINDINGS_FIELDS.map((key) => ({
    key,
    value: (findings as Record<string, unknown>)[key],
  })).filter((r) => typeof r.value === 'string' && r.value.trim() !== '');
  if (rows.length === 0) return null;
  return (
    <dl className={`grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs ${className ?? ''}`}>
      {rows.map(({ key, value }) => (
        <div key={key} className="min-w-0">
          <dt className="uppercase tracking-wide text-muted-foreground">{t(`findings.${key}`)}</dt>
          <dd className="font-medium tabular-nums">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
