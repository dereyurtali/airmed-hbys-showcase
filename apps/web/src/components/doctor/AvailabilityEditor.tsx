import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { TimeField } from '../ui/date-field';
import { DAYS_OF_WEEK, type AvailabilitySlot } from '../../lib/doctor.schemas';

interface Props {
  initial: AvailabilitySlot[];
  onSave: (slots: AvailabilitySlot[]) => Promise<void>;
  saving?: boolean;
  saveError?: string | null;
}

interface DraftSlot {
  /** Stable client-side key — backend never sees this. */
  key: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

let draftCounter = 0;
const draftKey = () => `draft-${++draftCounter}`;

const DAY_LABEL_KEYS: Record<number, string> = {
  1: 'days.monday',
  2: 'days.tuesday',
  3: 'days.wednesday',
  4: 'days.thursday',
  5: 'days.friday',
  6: 'days.saturday',
  0: 'days.sunday',
};
const DAY_SHORT_KEYS: Record<number, string> = {
  1: 'days.shortMonday',
  2: 'days.shortTuesday',
  3: 'days.shortWednesday',
  4: 'days.shortThursday',
  5: 'days.shortFriday',
  6: 'days.shortSaturday',
  0: 'days.shortSunday',
};

/**
 * Weekly availability grid editor. Each day is a row; rows can hold zero or
 * more disjoint time windows. Local validation mirrors the backend rules
 * (HH:MM, start<end, no same-day overlaps); the server enforces them too,
 * so a stray edge case still 400's instead of saving silently.
 */
export function AvailabilityEditor({ initial, onSave, saving, saveError }: Props) {
  const { t } = useTranslation('doctor');
  const [draft, setDraft] = useState<DraftSlot[]>(() => initialToDraft(initial));

  // Refresh draft when the parent reloads the data (e.g. after save invalidation).
  useEffect(() => {
    setDraft(initialToDraft(initial));
  }, [initial]);

  const validation = useMemo(() => validateDraft(draft, t), [draft, t]);
  const dirty = useMemo(() => !sameDraft(draft, initialToDraft(initial)), [draft, initial]);

  const addSlot = (dayOfWeek: number) => {
    setDraft((prev) => [
      ...prev,
      { key: draftKey(), dayOfWeek, startTime: '09:00', endTime: '17:00' },
    ]);
  };

  const removeSlot = (key: string) => {
    setDraft((prev) => prev.filter((s) => s.key !== key));
  };

  const updateSlot = (key: string, patch: Partial<DraftSlot>) => {
    setDraft((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };

  const handleSave = async () => {
    if (!validation.ok) return;
    await onSave(
      draft.map(({ dayOfWeek, startTime, endTime }) => ({
        dayOfWeek,
        startTime,
        endTime,
        isActive: true,
      })),
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table className="w-full text-sm">
          <TableHeader className="border-b bg-muted/40">
            <TableRow>
              <TableHead className="w-32 p-3 text-left font-medium">
                {t('availability.columns.day')}
              </TableHead>
              <TableHead className="p-3 text-left font-medium">
                {t('availability.columns.hours')}
              </TableHead>
              <TableHead className="w-24 p-3" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {DAYS_OF_WEEK.map((day) => {
              const daySlots = draft.filter((s) => s.dayOfWeek === day.value);
              const dayErrors = validation.errorsByDay.get(day.value) ?? [];
              const dayLabel = t(DAY_LABEL_KEYS[day.value]);
              const dayShort = t(DAY_SHORT_KEYS[day.value]);
              return (
                <TableRow key={day.value} className="border-b last:border-b-0">
                  <TableCell className="p-3 align-top">
                    <div className="font-medium">{dayShort}</div>
                    <div className="text-xs text-muted-foreground">{dayLabel}</div>
                  </TableCell>
                  <TableCell className="p-3">
                    {daySlots.length === 0 && (
                      <span className="text-sm text-muted-foreground">
                        {t('availability.noWork')}
                      </span>
                    )}
                    <div className="space-y-2">
                      {daySlots.map((slot) => (
                        <div key={slot.key} className="flex items-center gap-2">
                          <TimeField
                            value={slot.startTime}
                            onChange={(v) => updateSlot(slot.key, { startTime: v })}
                            className="w-28"
                            aria-label={t('availability.ariaStart')}
                          />
                          <span className="text-muted-foreground">—</span>
                          <TimeField
                            value={slot.endTime}
                            onChange={(v) => updateSlot(slot.key, { endTime: v })}
                            className="w-28"
                            aria-label={t('availability.ariaEnd')}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            type="button"
                            onClick={() => removeSlot(slot.key)}
                            aria-label={t('availability.remove')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    {dayErrors.length > 0 && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="h-3 w-3" />
                        {dayErrors.join(' · ')}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="p-3 align-top">
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => addSlot(day.value)}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      {t('availability.addSlot')}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {saveError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {saveError}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {dirty ? t('availability.dirty') : t('availability.clean')}
        </p>
        <div className="flex gap-2">
          {dirty && (
            <Button
              variant="outline"
              type="button"
              onClick={() => setDraft(initialToDraft(initial))}
            >
              {t('availability.revert')}
            </Button>
          )}
          <Button type="button" onClick={handleSave} disabled={!dirty || !validation.ok || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('availability.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function initialToDraft(slots: AvailabilitySlot[]): DraftSlot[] {
  return slots.map((s) => ({
    key: draftKey(),
    dayOfWeek: s.dayOfWeek,
    startTime: s.startTime,
    endTime: s.endTime,
  }));
}

function sameDraft(a: DraftSlot[], b: DraftSlot[]): boolean {
  if (a.length !== b.length) return false;
  const sortKey = (s: DraftSlot) => `${s.dayOfWeek}|${s.startTime}|${s.endTime}`;
  const sa = a.map(sortKey).sort();
  const sb = b.map(sortKey).sort();
  return sa.every((v, i) => v === sb[i]);
}

interface Validation {
  ok: boolean;
  errorsByDay: Map<number, string[]>;
}

function validateDraft(draft: DraftSlot[], t: (key: string) => string): Validation {
  const errorsByDay = new Map<number, string[]>();
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

  const push = (day: number, msg: string) => {
    const list = errorsByDay.get(day) ?? [];
    if (!list.includes(msg)) list.push(msg);
    errorsByDay.set(day, list);
  };

  for (const slot of draft) {
    if (!HHMM.test(slot.startTime) || !HHMM.test(slot.endTime)) {
      push(slot.dayOfWeek, t('availability.errors.format'));
      continue;
    }
    if (slot.startTime >= slot.endTime) {
      push(slot.dayOfWeek, t('availability.errors.endAfterStart'));
    }
  }

  // Overlap detection per day.
  const byDay = new Map<number, DraftSlot[]>();
  for (const s of draft) {
    const arr = byDay.get(s.dayOfWeek) ?? [];
    arr.push(s);
    byDay.set(s.dayOfWeek, arr);
  }
  for (const [day, slots] of byDay) {
    const sorted = [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startTime < sorted[i - 1].endTime) {
        push(day, t('availability.errors.overlap'));
        break;
      }
    }
  }

  return { ok: errorsByDay.size === 0, errorsByDay };
}
