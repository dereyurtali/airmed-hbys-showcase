import { localeToIntl } from '../../lib/i18n-format';
import { useState } from 'react';
import { TRPCClientError } from '@trpc/client';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DateField } from '../ui/date-field';
import { Label } from '../ui/label';
import { trpc } from '../../lib/trpc';
import { useLocale } from '../../providers/LocaleProvider';
import { useConfirm } from '../../hooks/useConfirm';

interface Props {
  doctorId: string;
  canEdit: boolean;
}

// Tüm-gün izin: input date'i (YYYY-MM-DD) ISO datetime'a çevir.
// startsAt = günün başı (00:00 local), endsAt = sonraki günün başı.
// Klinik tek TZ'de çalışıyor; user input'u local TZ'de yorumluyoruz.
function toStartOfDayISO(dateStr: string): string {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function toEndOfDayInclusiveISO(dateStr: string): string {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export function DoctorLeavesSection({ doctorId, canEdit }: Props) {
  const { t } = useTranslation('doctor');
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';
  const utils = trpc.useUtils();
  const { confirm } = useConfirm();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const list = trpc.doctor.listLeaves.useQuery({ doctorId });

  const add = trpc.doctor.addLeave.useMutation({
    onSuccess: async () => {
      toast.success(t('leaves.toast.added'));
      setStartDate('');
      setEndDate('');
      setReason('');
      setFormError(null);
      await utils.doctor.listLeaves.invalidate({ doctorId });
    },
    onError: (err) => {
      const msg = err instanceof TRPCClientError ? err.message : t('leaves.errors.addFailed');
      setFormError(msg);
      toast.error(msg);
    },
  });

  const remove = trpc.doctor.deleteLeave.useMutation({
    onSuccess: async () => {
      toast.success(t('leaves.toast.removed'));
      await utils.doctor.listLeaves.invalidate({ doctorId });
    },
    onError: (err) => {
      toast.error(err instanceof TRPCClientError ? err.message : t('leaves.errors.removeFailed'));
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!startDate || !endDate) {
      setFormError(t('leaves.errors.bothDates'));
      return;
    }
    if (startDate > endDate) {
      setFormError(t('leaves.errors.endBeforeStart'));
      return;
    }
    add.mutate({
      doctorId,
      startsAt: toStartOfDayISO(startDate),
      endsAt: toEndOfDayInclusiveISO(endDate),
      reason: reason.trim() || null,
    });
  };

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(dateLocale);

  return (
    <section className="space-y-3" aria-labelledby="doctor-leaves-heading">
      <header>
        <h2 id="doctor-leaves-heading" className="text-lg font-semibold">
          {t('leaves.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('leaves.description')}</p>
      </header>

      {canEdit && (
        <form
          className="grid gap-3 rounded-md border bg-card p-4 sm:grid-cols-[1fr_1fr_2fr_auto]"
          onSubmit={onSubmit}
        >
          <div>
            <Label htmlFor="leave-start">{t('leaves.fields.start')}</Label>
            <DateField id="leave-start" value={startDate} onChange={setStartDate} />
          </div>
          <div>
            <Label htmlFor="leave-end">{t('leaves.fields.end')}</Label>
            <DateField id="leave-end" value={endDate} onChange={setEndDate} />
          </div>
          <div>
            <Label htmlFor="leave-reason">{t('leaves.fields.reason')}</Label>
            <Input
              id="leave-reason"
              type="text"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('leaves.fields.reasonPlaceholder')}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={add.isPending} data-testid="leave-add">
              {add.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="mr-1 h-4 w-4" />
                  {t('leaves.actions.add')}
                </>
              )}
            </Button>
          </div>
          {formError && (
            <p
              role="alert"
              className="sm:col-span-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}
        </form>
      )}

      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('leaves.loading')}</p>
      ) : list.data && list.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('leaves.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {list.data?.map((leave) => (
            <li
              key={leave.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div>
                <span className="font-medium">
                  {fmt(leave.startsAt)} – {fmt(leave.endsAt)}
                </span>
                {leave.reason && (
                  <span className="ml-2 text-muted-foreground">· {leave.reason}</span>
                )}
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        message: t('leaves.actions.removeConfirm'),
                        destructive: true,
                      })
                    ) {
                      remove.mutate({ id: leave.id });
                    }
                  }}
                  aria-label={t('leaves.actions.remove')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
