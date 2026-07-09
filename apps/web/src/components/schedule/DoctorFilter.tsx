import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { doctorColor } from '../../lib/doctor-colors';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

interface DoctorOption {
  id: string;
  name: string;
}

interface Props {
  doctors: DoctorOption[];
  selectedIds: string[];
  isLoading?: boolean;
  onChange: (ids: string[]) => void;
}

export function DoctorFilter({ doctors, selectedIds, isLoading, onChange }: Props) {
  const { t } = useTranslation('appointment');
  const allSelected = selectedIds.length === 0; // boş = hepsi (varsayılan)

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((d) => d !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const buttonLabel = allSelected
    ? t('filters.allDoctors')
    : t('filters.selectedCount', { count: selectedIds.length });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" disabled={isLoading}>
          {t('filters.doctors')}: {buttonLabel}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {t('filters.doctors')}
            </span>
            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-primary hover:underline"
              >
                {t('filters.clearAll')}
              </button>
            )}
          </div>
          {doctors.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('filters.noDoctors')}</p>
          )}
          <ul className="max-h-64 space-y-1 overflow-auto" role="listbox" aria-multiselectable>
            {doctors.map((d) => {
              const checked = selectedIds.includes(d.id);
              return (
                <li key={d.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(d.id)}
                      className="h-4 w-4"
                    />
                    {/* #1018 — takvim kartındaki sol şerit/rozet rengiyle aynı (renk rehberi burada). */}
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${doctorColor(d.id).dot}`}
                      aria-hidden
                    />
                    {d.name}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
