import { useTranslation } from 'react-i18next';
import {
  CREATABLE_APPOINTMENT_TYPES,
  APPOINTMENT_TYPE_META,
  type AppointmentType,
} from '../../lib/appointment.constants';
import { cn } from '../../lib/utils';

interface Props {
  selected: AppointmentType[];
  onChange: (types: AppointmentType[]) => void;
}

export function TypeFilter({ selected, onChange }: Props) {
  const { t } = useTranslation('appointment');

  const toggle = (type: AppointmentType) => {
    if (selected.includes(type)) {
      onChange(selected.filter((t) => t !== type));
    } else {
      onChange([...selected, type]);
    }
  };

  return (
    <ul className="flex flex-wrap gap-2" aria-label="type-filter">
      {/* Yalnız oluşturulabilir 5 tip çip olur; legacy/auto tipler
          (examination/pre_op/post_op) takvimde render olur ama SchedulePage
          init'i tüm tipleri seçili tuttuğundan filtreden gizlenmez. */}
      {CREATABLE_APPOINTMENT_TYPES.map((type) => {
        const meta = APPOINTMENT_TYPE_META[type];
        const Icon = meta.icon;
        const active = selected.includes(type);
        return (
          <li key={type}>
            <button
              type="button"
              onClick={() => toggle(type)}
              aria-pressed={active}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
                active
                  ? `${meta.bg} ${meta.color} ${meta.border}`
                  : 'border-input text-muted-foreground hover:bg-muted',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {t(meta.labelKey)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
