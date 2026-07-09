import { useState } from 'react';
import { TRPCClientError } from '@trpc/client';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { localeToIntl } from '../../lib/i18n-format';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DateField, TimeField } from '../ui/date-field';
import { Label } from '../ui/label';
import { trpc } from '../../lib/trpc';
import { useLocale } from '../../providers/LocaleProvider';
import { usePermission } from '../../hooks/usePermission';
import { useConfirm } from '../../hooks/useConfirm';

interface Props {
  doctorId: string;
}

// Tarih + saat girdisini yerel Date üzerinden ISO'ya çevir (izin bölümüyle
// aynı konvansiyon: klinik tek TZ, input yerel TZ'de yorumlanır). Pencere
// izinden farklı olarak saat hassasiyetli — misafir doktor "14 Temmuz
// 10:00-16:00" gibi yarım gün gelebilir.
function toISO(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0).toISOString();
}

/**
 * Misafir doktorun "Geliş Pencereleri" bölümü (#1048) — DoctorLeavesSection
 * ikizi. Pencere = doktorun klinikte bulunacağı mutlak tarih/saat aralığı;
 * randevu YALNIZ pencere içinde verilebilir (penceresiz misafir = randevuya
 * kapalı, #1047). Yalnız doctor.type === 'visiting' iken render edilir.
 */
export function DoctorVisitingWindowsSection({ doctorId }: Props) {
  const { t } = useTranslation('doctor');
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';
  const utils = trpc.useUtils();
  const { confirm } = useConfirm();
  // İzin/mesai yönetimiyle aynı gate (#1047 router kararı) — yetkisiz rolde
  // mutasyon butonları GİZLİ (disabled değil; airmed-design kuralı).
  const canManage = usePermission('action:doctor.setAvailability');

  // Varsayılan mesai saatleri (tek kaynak — initializer + form reset).
  const DEFAULT_START_TIME = '09:00';
  const DEFAULT_END_TIME = '18:00';
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => {
    setStartDate('');
    setStartTime(DEFAULT_START_TIME);
    setEndDate('');
    setEndTime(DEFAULT_END_TIME);
    setNotes('');
    setFormError(null);
  };

  const list = trpc.doctor.listVisitingWindows.useQuery({ doctorId });
  const isEmpty = list.data?.length === 0;

  const invalidate = async () => {
    await Promise.all([
      utils.doctor.listVisitingWindows.invalidate({ doctorId }),
      utils.doctor.findVisitingWindowsInRange.invalidate(),
    ]);
  };

  const add = trpc.doctor.addVisitingWindow.useMutation({
    onSuccess: async () => {
      toast.success(t('visitingWindows.toast.added'));
      resetForm();
      await invalidate();
    },
    onError: (err) => {
      const msg =
        err instanceof TRPCClientError ? err.message : t('visitingWindows.errors.addFailed');
      setFormError(msg);
      toast.error(msg);
    },
  });

  const remove = trpc.doctor.deleteVisitingWindow.useMutation({
    onSuccess: async () => {
      toast.success(t('visitingWindows.toast.removed'));
      await invalidate();
    },
    onError: (err) => {
      toast.error(
        err instanceof TRPCClientError ? err.message : t('visitingWindows.errors.removeFailed'),
      );
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!startDate || !endDate || !startTime || !endTime) {
      setFormError(t('visitingWindows.errors.allFields'));
      return;
    }
    const startsAt = toISO(startDate, startTime);
    const endsAt = toISO(endDate, endTime);
    if (startsAt >= endsAt) {
      setFormError(t('visitingWindows.errors.endBeforeStart'));
      return;
    }
    add.mutate({ doctorId, startsAt, endsAt, notes: notes.trim() || null });
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(dateLocale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  return (
    <section className="space-y-3" aria-labelledby="doctor-visiting-windows-heading">
      <header>
        <h2 id="doctor-visiting-windows-heading" className="text-lg font-semibold">
          {t('visitingWindows.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('visitingWindows.description')}</p>
      </header>

      {/* #1047 — penceresiz misafir doktor RANDEVUYA KAPALI: kalıcı uyarı,
          dismiss yok (durumsal banner — pencere eklenince kendiliğinden kalkar). */}
      {isEmpty && (
        <div
          role="status"
          data-testid="visiting-window-none-banner"
          className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm font-medium text-warning-foreground"
        >
          {t('visitingWindows.noneBanner')}
        </div>
      )}

      {canManage && (
        <form
          className="grid gap-3 rounded-md border bg-card p-4 sm:grid-cols-4"
          onSubmit={onSubmit}
        >
          <div>
            <Label htmlFor="visiting-window-start-date">{t('visitingWindows.fields.start')}</Label>
            <DateField id="visiting-window-start-date" value={startDate} onChange={setStartDate} />
          </div>
          <div>
            <Label htmlFor="visiting-window-start-time">
              {t('visitingWindows.fields.startTime')}
            </Label>
            <TimeField id="visiting-window-start-time" value={startTime} onChange={setStartTime} />
          </div>
          <div>
            <Label htmlFor="visiting-window-end-date">{t('visitingWindows.fields.end')}</Label>
            <DateField id="visiting-window-end-date" value={endDate} onChange={setEndDate} />
          </div>
          <div>
            <Label htmlFor="visiting-window-end-time">{t('visitingWindows.fields.endTime')}</Label>
            <TimeField id="visiting-window-end-time" value={endTime} onChange={setEndTime} />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="visiting-window-notes">{t('visitingWindows.fields.notes')}</Label>
            <Input
              id="visiting-window-notes"
              type="text"
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('visitingWindows.fields.notesPlaceholder')}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={add.isPending} data-testid="visiting-window-add">
              {add.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="mr-1 h-4 w-4" />
                  {t('visitingWindows.actions.add')}
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
        <p className="text-sm text-muted-foreground">{t('visitingWindows.loading')}</p>
      ) : isEmpty ? (
        <p className="text-sm text-muted-foreground">{t('visitingWindows.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {list.data?.map((window) => (
            <li
              key={window.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div>
                <span className="font-medium tabular-nums">
                  {fmt(window.startsAt)} – {fmt(window.endsAt)}
                </span>
                {window.notes && (
                  <span className="ml-2 text-muted-foreground">· {window.notes}</span>
                )}
              </div>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        message: t('visitingWindows.actions.removeConfirm'),
                        destructive: true,
                      })
                    ) {
                      remove.mutate({ id: window.id });
                    }
                  }}
                  aria-label={t('visitingWindows.actions.remove')}
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
