import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Loader2, Pencil, Stethoscope } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import {
  APPOINTMENT_STATUS_META,
  APPOINTMENT_TYPE_META,
  type AppointmentStatus,
  type AppointmentType,
} from '../../lib/appointment.constants';
import { ROLES } from '@airmed/contracts';
import { formatTimeRange } from '../../lib/schedule.utils';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';
import { useAuth } from '../../providers/AuthProvider';
import { useLocale } from '../../providers/LocaleProvider';
import { cn } from '../../lib/utils';
import { AppointmentStatusActions } from './AppointmentStatusActions';

interface Props {
  appointmentId: string | null;
  onClose: () => void;
  onEdit?: (appointmentId: string) => void;
}

export function AppointmentDetailSheet({ appointmentId, onClose, onEdit }: Props) {
  const { t } = useTranslation('appointment');
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const detail = trpc.appointment.findById.useQuery(
    { id: appointmentId ?? '' },
    { enabled: !!appointmentId },
  );

  const isAdmin = !!user?.roles.some((r) => r === ROLES.YONETICI || r === ROLES.YONETICI_ASISTANI);
  const myProfile = trpc.doctor.myProfile.useQuery(undefined, { enabled: !isAdmin });

  const startExam = trpc.encounter.startExam.useMutation({
    onSuccess: async (_data, vars) => {
      await Promise.all([
        utils.appointment.findInRange.invalidate(),
        utils.encounter.myWorklist.invalidate(),
      ]);
      const patientId = detail.data?.patient.id;
      onClose();
      if (patientId) navigate(`/patients/${patientId}`);
      void vars;
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });

  return (
    <Dialog open={!!appointmentId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent variant="drawer-right">
        <DialogTitle>{t('detail.title')}</DialogTitle>

        {detail.isLoading && (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('detail.loading')}
          </div>
        )}

        {detail.error && (
          <p className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {detail.error.message}
          </p>
        )}

        {detail.data && (
          <article className="mt-6 space-y-5">
            <header className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('detail.patient')}
              </p>
              <h3 className="text-lg font-semibold">
                {detail.data.patient.firstName} {detail.data.patient.lastName}
              </h3>
              <p className="text-xs text-muted-foreground">{detail.data.patient.mrn}</p>
            </header>

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{t('detail.doctor')}</dt>
                {/* #367 — Doktorsuz (havuz) randevu: doktor henüz atanmadı. */}
                <dd>
                  {detail.data.doctor?.name ??
                    t('detail.anyDoctor', { defaultValue: 'Havuz (atanmadı)' })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('detail.specialty')}</dt>
                <dd>{detail.data.doctor?.specialty ?? '—'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">{t('detail.time')}</dt>
                <dd>
                  {formatTimeRange(
                    new Date(detail.data.startsAt),
                    new Date(detail.data.endsAt),
                    locale,
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('detail.type')}</dt>
                <dd>
                  <TypeBadge type={detail.data.type as AppointmentType} t={t} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('detail.status')}</dt>
                <dd>
                  <StatusBadge status={detail.data.status as AppointmentStatus} t={t} />
                </dd>
              </div>
            </dl>

            {detail.data.notes && (
              <section>
                <p className="text-xs text-muted-foreground">{t('detail.notes')}</p>
                <p className="whitespace-pre-wrap text-sm">{detail.data.notes}</p>
              </section>
            )}

            <section className="border-t pt-4">
              <p className="mb-2 text-xs text-muted-foreground">{t('detail.actions')}</p>
              {detail.data.status === 'checked_in' &&
                (isAdmin || myProfile.data?.id === detail.data.doctor?.id) && (
                  <Button
                    type="button"
                    size="sm"
                    className="mb-3 w-full"
                    disabled={startExam.isPending}
                    data-testid="start-exam"
                    onClick={() => startExam.mutate({ appointmentId: detail.data.id })}
                  >
                    <Stethoscope className="mr-1 h-4 w-4" />
                    {t('detail.startExam')}
                  </Button>
                )}
              <AppointmentStatusActions
                appointmentId={detail.data.id}
                currentStatus={detail.data.status as AppointmentStatus}
              />
              {onEdit && detail.data.status === 'scheduled' && (
                <EditButton t={t} id={detail.data.id} onEdit={onEdit} />
              )}
            </section>
          </article>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditButton({
  id,
  t,
  onEdit,
}: {
  id: string;
  t: (key: string) => string;
  onEdit: (id: string) => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="mt-3"
      onClick={() => onEdit(id)}
      data-testid="appointment-edit"
    >
      <Pencil className="mr-1 h-4 w-4" />
      {t('detail.editAction')}
    </Button>
  );
}

function TypeBadge({ type, t }: { type: AppointmentType; t: (key: string) => string }) {
  const meta = APPOINTMENT_TYPE_META[type];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs',
        meta.bg,
        meta.color,
        meta.border,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {t(meta.labelKey)}
    </span>
  );
}

function StatusBadge({ status, t }: { status: AppointmentStatus; t: (key: string) => string }) {
  const meta = APPOINTMENT_STATUS_META[status];
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs', meta.badge)}>
      {t(meta.labelKey)}
    </span>
  );
}
