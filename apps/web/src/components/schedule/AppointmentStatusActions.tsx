import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { isLegalTransition, type AppointmentStatus } from '../../lib/appointment.constants';
import { trpc } from '../../lib/trpc';

interface Props {
  appointmentId: string;
  currentStatus: AppointmentStatus;
  // Resepsiyon kokpitinden çağrılırsa: check-in başarısı zincir tetikler
  // (InvoiceCreateDialog veya PaymentDialog). Eski çağıranlar (schedule sayfası,
  // detail sheet) bunu geçmez — toast'la kalır.
  onCheckInComplete?: () => void;
}

interface ActionConfig {
  to: AppointmentStatus;
  labelKey: string;
  variant: 'default' | 'outline' | 'destructive';
  procedure: 'checkIn' | 'markDone' | 'cancel' | 'markNoShow';
}

const ACTIONS: ActionConfig[] = [
  { to: 'checked_in', labelKey: 'actions.checkIn', variant: 'default', procedure: 'checkIn' },
  { to: 'completed', labelKey: 'actions.markDone', variant: 'default', procedure: 'markDone' },
  { to: 'cancelled', labelKey: 'actions.cancel', variant: 'destructive', procedure: 'cancel' },
  { to: 'no_show', labelKey: 'actions.markNoShow', variant: 'outline', procedure: 'markNoShow' },
];

export function AppointmentStatusActions({
  appointmentId,
  currentStatus,
  onCheckInComplete,
}: Props) {
  const { t } = useTranslation('appointment');
  const utils = trpc.useUtils();

  const handleSettled = async () => {
    await Promise.all([
      utils.appointment.findInRange.invalidate(),
      utils.appointment.findById.invalidate({ id: appointmentId }),
    ]);
  };

  const checkIn = trpc.appointment.checkIn.useMutation({
    onSuccess: async () => {
      // Zincir varsa toast'ı atla; kokpit kendi UX akışını sürdürür.
      if (onCheckInComplete) {
        onCheckInComplete();
      } else {
        toast.success(t('toast.statusUpdated'));
      }
      await handleSettled();
    },
    onError: (err) => toast.error(toMessage(err, t)),
  });
  const markDone = trpc.appointment.markDone.useMutation({
    onSuccess: async () => {
      toast.success(t('toast.statusUpdated'));
      await handleSettled();
    },
    onError: (err) => toast.error(toMessage(err, t)),
  });
  const cancel = trpc.appointment.cancel.useMutation({
    onSuccess: async () => {
      toast.success(t('toast.statusUpdated'));
      await handleSettled();
    },
    onError: (err) => toast.error(toMessage(err, t)),
  });
  const markNoShow = trpc.appointment.markNoShow.useMutation({
    onSuccess: async () => {
      toast.success(t('toast.statusUpdated'));
      await handleSettled();
    },
    onError: (err) => toast.error(toMessage(err, t)),
  });

  const procedures = { checkIn, markDone, cancel, markNoShow } as const;
  const pending = Object.values(procedures).some((m) => m.isPending);

  // #406 — geri-alınamaz aksiyonlar (iptal, gelmedi) tek-tık yerine teyit ister.
  const DESTRUCTIVE = new Set<ActionConfig['procedure']>(['cancel', 'markNoShow']);
  const [confirmAction, setConfirmAction] = useState<ActionConfig | null>(null);
  const runAction = (action: ActionConfig) =>
    procedures[action.procedure].mutate({ id: appointmentId });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((action) => {
          const legal = isLegalTransition(currentStatus, action.to);
          return (
            <Button
              key={action.procedure}
              type="button"
              size="touch"
              variant={action.variant}
              disabled={!legal || pending}
              title={legal ? undefined : t('actions.illegalTransition')}
              onClick={() =>
                DESTRUCTIVE.has(action.procedure) ? setConfirmAction(action) : runAction(action)
              }
            >
              {t(action.labelKey)}
            </Button>
          );
        })}
      </div>
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title={confirmAction ? t(confirmAction.labelKey) : ''}
        description={t('actions.confirmIrreversible')}
        confirmLabel={confirmAction ? t(confirmAction.labelKey) : undefined}
        pending={pending}
        onConfirm={() => {
          if (confirmAction) runAction(confirmAction);
          setConfirmAction(null);
        }}
      />
    </>
  );
}

function toMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof TRPCClientError) return err.message;
  return t('toast.unknownError');
}
