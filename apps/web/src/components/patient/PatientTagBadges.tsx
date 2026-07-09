import { useTranslation } from 'react-i18next';
import { PATIENT_TAGS, TAG_COLOR, type PatientTag } from '../../lib/patient-tags.constants';

interface Props {
  tags: readonly string[];
  size?: 'sm' | 'md';
}

export function PatientTagBadges({ tags, size = 'md' }: Props) {
  const { t } = useTranslation('patient');
  if (!tags || tags.length === 0) return null;
  const allowed = new Set<string>(PATIENT_TAGS as readonly string[]);
  const padding = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {tags
        .filter((tg) => allowed.has(tg))
        .map((tg) => (
          <span
            key={tg}
            className={`inline-flex items-center rounded-full border font-medium ${padding} ${
              TAG_COLOR[tg as PatientTag]
            }`}
          >
            {t(`tags.${tg}`)}
          </span>
        ))}
    </span>
  );
}
