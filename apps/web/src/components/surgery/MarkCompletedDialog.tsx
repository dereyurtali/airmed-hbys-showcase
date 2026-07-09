import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CalendarDays, CheckCircle2, Loader2, ShieldAlert, ShieldCheck, User } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';
import { useLocale } from '../../providers/LocaleProvider';
import { formatDate } from '../../lib/i18n-format';

// #418 + #392 — Cerrahi time-out tek-ekran doğrulaması. markCompleted öncesi
// ekip hasta + göz tarafı + lens + doktoru tek ekranda görür; ikinci kimlik
// doğrulaması (MRN / doğum tarihi) yapılmadan ve WHO güvenlik kontrol listesi
// tamamlanmadan "Tamamla" butonu açılmaz. Yanlış-göz/lens uyuşmazlık backend'de
// hard-block (assertEyeLaterality); bu ekran ekibe gözü/lensi teyit ettirir.
// Tamamlama sonrası otomatik post-op kontrol zinciri (1.gün/1.hafta/1.ay/3.ay).

interface Props {
  surgeryId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSuccess?: () => void;
}

const onlyDigits = (s: string) => s.replace(/\D/g, '');

export function MarkCompletedDialog({ surgeryId, open, onOpenChange, onSuccess }: Props) {
  const { t } = useTranslation(['surgery', 'common']);
  const { locale } = useLocale();
  const [skipAutoSchedule, setSkipAutoSchedule] = useState(false);
  const [slotHour, setSlotHour] = useState(10);
  const [identity, setIdentity] = useState('');

  const detail = trpc.surgery.findById.useQuery({ id: surgeryId }, { enabled: open });
  const safety = trpc.surgery.safetyChecklist.get.useQuery({ surgeryId }, { enabled: open });

  const mutation = trpc.surgery.markCompleted.useMutation({
    onSuccess: (data) => {
      const scheduled = data.autoScheduledAppointments.length;
      toast.success(
        scheduled > 0
          ? t('surgery:timeout.successScheduled', {
              count: scheduled,
              defaultValue: `Ameliyat tamamlandı. ${scheduled} post-op kontrol randevusu açıldı.`,
            })
          : t('surgery:timeout.success'),
      );
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });

  const surgery = detail.data;
  const patient = surgery?.patient;

  // İkinci kimlik doğrulaması: MRN (büyük/küçük harf duyarsız) VEYA doğum
  // tarihi (GG.AA.YYYY veya YYYY-AA-GG — sadece rakamlar karşılaştırılır).
  const identityVerified = useMemo(() => {
    if (!patient) return false;
    const inp = identity.trim();
    if (!inp) return false;
    if (inp.toLowerCase() === patient.mrn.toLowerCase()) return true;
    if (patient.birthDate) {
      const bd = new Date(patient.birthDate);
      const dd = String(bd.getUTCDate()).padStart(2, '0');
      const mm = String(bd.getUTCMonth() + 1).padStart(2, '0');
      const yyyy = String(bd.getUTCFullYear());
      const inputDigits = onlyDigits(inp);
      if (
        inputDigits.length >= 8 &&
        (inputDigits === dd + mm + yyyy || inputDigits === yyyy + mm + dd)
      )
        return true;
    }
    return false;
  }, [identity, patient]);

  const safetyComplete = safety.data?.fullyComplete === true;
  const canComplete = identityVerified && safetyComplete && !mutation.isPending;

  const eyeSide = surgery?.eyeSide;
  const lensLabel = surgery?.lensSerialNumber
    ? surgery.lensSerialNumber
    : surgery?.lensImplantLotId
      ? t('surgery:timeout.lensFromLot')
      : t('surgery:timeout.noLens');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{t('surgery:timeout.title')}</DialogTitle>
        <DialogDescription>
          {t('surgery:timeout.description', {
            defaultValue:
              'Tamamlamadan önce hasta, göz tarafı ve lensi ekiple sesli teyit edin. İkinci kimlik doğrulaması zorunludur.',
          })}
        </DialogDescription>

        {detail.isLoading || safety.isLoading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !surgery || !patient ? (
          <p className="py-6 text-sm text-destructive">{t('surgery:timeout.loadFailed')}</p>
        ) : (
          <div className="mt-2 space-y-4">
            {/* Time-out özet kartı */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="col-span-2 flex items-center gap-2 font-medium">
                <User className="h-4 w-4 text-muted-foreground" />
                {patient.firstName} {patient.lastName}
                <span className="text-xs text-muted-foreground">({patient.mrn})</span>
              </div>
              <TimeoutField
                label={t('surgery:timeout.birthDate')}
                value={patient.birthDate ? formatDate(patient.birthDate, locale) : '—'}
              />
              <TimeoutField
                label={t('surgery:timeout.doctor')}
                value={surgery.doctor?.name ?? '—'}
              />
              <TimeoutField label={t('surgery:timeout.procedure')} value={surgery.type} />
              <div>
                <dt className="text-xs text-muted-foreground">{t('surgery:timeout.eyeSide')}</dt>
                <dd>
                  {eyeSide ? (
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${
                        eyeSide === 'ou'
                          ? 'bg-warning-bg text-warning-foreground'
                          : 'bg-info-bg text-info-foreground'
                      }`}
                    >
                      {eyeSide}
                    </span>
                  ) : (
                    <span className="text-critical-foreground">
                      {t('surgery:timeout.eyeMissing')}
                    </span>
                  )}
                </dd>
              </div>
              <TimeoutField label={t('surgery:timeout.lens')} value={lensLabel} />
            </dl>

            {/* WHO güvenlik kontrol listesi kapısı */}
            {safetyComplete ? (
              <p className="flex items-center gap-2 rounded-lg bg-success-bg px-3 py-2 text-sm text-success-foreground">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                {t('surgery:timeout.safetyOk', {
                  defaultValue: 'WHO güvenlik kontrol listesi tamamlandı.',
                })}
              </p>
            ) : (
              <p className="flex items-center gap-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical-foreground">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                {t('surgery:timeout.safetyBlocked', {
                  defaultValue:
                    'WHO güvenlik kontrol listesi tamamlanmadı (sign-in / time-out / sign-out). Önce güvenlik kontrolünü tamamlayın.',
                })}
              </p>
            )}

            {/* İkinci kimlik doğrulaması */}
            <label className="block text-sm">
              <span className="mb-1 block font-medium">
                {t('surgery:timeout.identityLabel', {
                  defaultValue:
                    'İkinci kimlik doğrulaması — hasta MRN veya doğum tarihi (GG.AA.YYYY)',
                })}
              </span>
              <input
                type="text"
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                autoComplete="off"
                placeholder={patient.mrn}
                data-testid="identity-verify"
                className={`h-9 w-full rounded-md border bg-background px-2 text-sm ${
                  identity && !identityVerified ? 'border-destructive' : 'border-input'
                }`}
              />
              {identity &&
                (identityVerified ? (
                  <span className="mt-1 flex items-center gap-1 text-xs text-success-foreground">
                    <CheckCircle2 className="h-3 w-3" />
                    {t('surgery:timeout.identityOk')}
                  </span>
                ) : (
                  <span className="mt-1 block text-xs text-critical-foreground">
                    {t('surgery:timeout.identityMismatch', {
                      defaultValue: 'MRN veya doğum tarihi eşleşmiyor',
                    })}
                  </span>
                ))}
            </label>

            {/* Post-op otomatik planlama */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!skipAutoSchedule}
                onChange={(e) => setSkipAutoSchedule(!e.target.checked)}
                data-testid="auto-schedule"
              />
              {t('surgery:timeout.autoSchedule', {
                defaultValue: 'Post-op kontrolleri otomatik planla (1.gün / 1.hafta / 1.ay / 3.ay)',
              })}
            </label>

            {!skipAutoSchedule && (
              <label className="block text-sm">
                <span className="mb-1 flex items-center gap-1 font-medium">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {t('surgery:timeout.slotHour')}
                </span>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={slotHour}
                  onChange={(e) => setSlotHour(parseInt(e.target.value, 10))}
                >
                  {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((h) => (
                    <option key={h} value={h}>
                      {h.toString().padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common:cancel', { defaultValue: 'Vazgeç' })}
              </Button>
              <Button
                disabled={!canComplete}
                onClick={() =>
                  mutation.mutate({
                    surgeryId,
                    skipAutoSchedule,
                    slotHour: skipAutoSchedule ? undefined : slotHour,
                  })
                }
                data-testid="mark-completed-submit"
              >
                {mutation.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                )}
                {t('surgery:timeout.submit')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TimeoutField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
