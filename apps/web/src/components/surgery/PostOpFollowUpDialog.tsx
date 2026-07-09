import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { DateTimeField } from '../ui/date-field';
import { Label } from '../ui/label';
import { trpc } from '../../lib/trpc';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surgeryId: string;
  performedAt: Date;
  onScheduled: () => void;
}

interface Proposal {
  daysFromSurgery: number;
  startsAt: string; // datetime-local string (no Z)
  endsAt: string;
}

const DEFAULT_INTERVALS = [7, 30, 90] as const;
const DEFAULT_SLOT_HOUR = 10;
const DEFAULT_DURATION_MIN = 30;

function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildDefaults(performedAt: Date): Proposal[] {
  return DEFAULT_INTERVALS.map((days) => {
    const start = new Date(performedAt);
    start.setDate(start.getDate() + days);
    start.setHours(DEFAULT_SLOT_HOUR, 0, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + DEFAULT_DURATION_MIN);
    return {
      daysFromSurgery: days,
      startsAt: toDateTimeLocal(start),
      endsAt: toDateTimeLocal(end),
    };
  });
}

export function PostOpFollowUpDialog({
  open,
  onOpenChange,
  surgeryId,
  performedAt,
  onScheduled,
}: Props) {
  const { t } = useTranslation(['postOp', 'common']);
  const utils = trpc.useUtils();

  const [proposals, setProposals] = useState<Proposal[]>(() => buildDefaults(performedAt));
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProposals(buildDefaults(performedAt));
    setFormError(null);
  }, [open, performedAt]);

  const handleError = (err: unknown) => {
    let msg = t('postOp:errors.unknown');
    if (err instanceof TRPCClientError) {
      const raw = err.message;
      if (raw.includes('already scheduled')) {
        msg = t('postOp:errors.alreadyScheduled');
      } else if (raw.includes('conflicts with another appointment')) {
        msg = t('postOp:errors.conflict');
      } else if (raw.includes('Only the operating surgeon')) {
        msg = t('postOp:errors.forbidden');
      } else if (raw.includes('no doctor profile')) {
        msg = t('postOp:errors.surgeonNoProfile');
      } else {
        msg = raw;
      }
    }
    setFormError(msg);
    toast.error(msg);
  };

  const schedule = trpc.postOp.scheduleFollowUps.useMutation({
    onSuccess: async (created: { id: string }[]) => {
      toast.success(t('postOp:toast.scheduled', { count: created.length }));
      await utils.postOp.listFollowUps.invalidate({ surgeryId });
      onScheduled();
      onOpenChange(false);
    },
    onError: handleError,
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    schedule.mutate({
      surgeryId,
      proposals: proposals.map((p) => ({
        daysFromSurgery: p.daysFromSurgery,
        startsAt: new Date(p.startsAt).toISOString(),
        endsAt: new Date(p.endsAt).toISOString(),
      })),
    });
  };

  const updateProposal = (idx: number, patch: Partial<Proposal>) => {
    setProposals((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{t('postOp:dialog.title')}</DialogTitle>
        <DialogDescription>{t('postOp:dialog.description')}</DialogDescription>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="space-y-3">
            {proposals.map((p, idx) => (
              <div
                key={idx}
                className="rounded-lg border bg-muted/20 p-3"
                data-testid={`postop-proposal-${idx}`}
              >
                <div className="mb-2 text-sm font-medium">
                  {t('postOp:dialog.followUpHeader', {
                    n: idx + 1,
                    days: p.daysFromSurgery,
                  })}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`po-start-${idx}`}>{t('postOp:dialog.startsAt')}</Label>
                    <DateTimeField
                      id={`po-start-${idx}`}
                      value={p.startsAt}
                      onChange={(v) => updateProposal(idx, { startsAt: v })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`po-end-${idx}`}>{t('postOp:dialog.endsAt')}</Label>
                    <DateTimeField
                      id={`po-end-${idx}`}
                      value={p.endsAt}
                      onChange={(v) => updateProposal(idx, { endsAt: v })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={schedule.isPending}>
              {schedule.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('postOp:dialog.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
