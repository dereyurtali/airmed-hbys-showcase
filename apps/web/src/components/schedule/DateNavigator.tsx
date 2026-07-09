import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { DateField } from '../ui/date-field';
import { addDays, formatDayLabel, isSameDay, startOfDay } from '../../lib/schedule.utils';

// #399 — Native date input için YYYY-MM-DD (yerel) ↔ Date.
function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

interface Props {
  selectedDate: Date;
  locale: string;
  onChange: (date: Date) => void;
}

export function DateNavigator({ selectedDate, locale, onChange }: Props) {
  const { t } = useTranslation('appointment');
  const today = new Date();
  const showsToday = isSameDay(selectedDate, today);

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        aria-label={t('date.previous')}
        onClick={() => onChange(addDays(selectedDate, -1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant={showsToday ? 'default' : 'outline'}
        size="sm"
        onClick={() => onChange(startOfDay(today))}
      >
        {t('date.today')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label={t('date.next')}
        onClick={() => onChange(addDays(selectedDate, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      {/* #399 — Gün etiketi tıklanınca tarih seçici popover (ileri tarih için
          ±1 gün spam'i yerine doğrudan atla; "3 hafta sonra" 21 tık → 2 tık). */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('date.pick', { defaultValue: 'Tarih seç' })}
          >
            <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span aria-live="polite">{formatDayLabel(selectedDate, locale)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t('date.pick', { defaultValue: 'Tarih seç' })}
            <DateField
              value={toInputDate(selectedDate)}
              onChange={(v) => {
                if (!v) return;
                const [y, m, d] = v.split('-').map(Number);
                onChange(startOfDay(new Date(y, m - 1, d)));
              }}
            />
          </label>
        </PopoverContent>
      </Popover>
    </div>
  );
}
