import { useTranslation } from 'react-i18next';
import { PATIENT_TAGS, TAG_COLOR, type PatientTag } from '../../lib/patient-tags.constants';

interface Props {
  value: readonly string[];
  onChange: (next: PatientTag[]) => void;
  disabled?: boolean;
}

export function PatientTagPicker({ value, onChange, disabled }: Props) {
  const { t } = useTranslation('patient');
  const set = new Set(value);

  const toggle = (tag: PatientTag) => {
    const next = new Set(set);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    onChange(Array.from(next) as PatientTag[]);
  };

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('tags.pickerLabel')}>
      {PATIENT_TAGS.map((tg) => {
        const active = set.has(tg);
        return (
          <button
            key={tg}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => toggle(tg)}
            className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium transition ${
              active
                ? TAG_COLOR[tg]
                : 'border-input bg-background text-muted-foreground hover:bg-muted'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {t(`tags.${tg}`)}
          </button>
        );
      })}
    </div>
  );
}
