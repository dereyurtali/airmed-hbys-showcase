import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';

// S15-PR16 — Cerrahi reddi dialog. Yapısal sebep + opsiyonel notlar.
// Backend kuralı: reason='other' → notlar zorunlu (≥10 char).

const REFUSAL_REASONS = [
  'financial',
  'medical_concern',
  'family',
  'second_opinion',
  'other',
] as const;
type RefusalReason = (typeof REFUSAL_REASONS)[number];

interface SurgeryRefusalDialogProps {
  surgeryId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSuccess?: () => void;
}

export function SurgeryRefusalDialog({
  surgeryId,
  open,
  onOpenChange,
  onSuccess,
}: SurgeryRefusalDialogProps) {
  const { t } = useTranslation('surgery');
  const [reason, setReason] = useState<RefusalReason>('financial');
  const [notes, setNotes] = useState('');

  // S15-PR16 — tRPC type instantiation derinliği surgery router'da limitleri
  // zorladığı için `as never` cast'i sadece useMutation chain'i için kullanıldı.
  // Runtime davranışı değişmez; sadece TS depth kısaltması.
  const markRefused = (
    trpc.surgery as never as {
      markRefused: {
        useMutation: (opts: {
          onSuccess: () => void;
          onError: (err: { message: string }) => void;
        }) => {
          mutate: (input: {
            surgeryId: string;
            refusalReason: RefusalReason;
            refusalNotes: string | null;
          }) => void;
          isPending: boolean;
        };
      };
    }
  ).markRefused.useMutation({
    onSuccess: () => {
      toast.success(t('refusal.success'));
      onOpenChange(false);
      setReason('financial');
      setNotes('');
      onSuccess?.();
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });

  const isOtherInvalid = reason === 'other' && notes.trim().length < 10;
  const canSubmit = !isOtherInvalid && !markRefused.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('refusal.title')}</DialogTitle>
        <DialogDescription>{t('refusal.description')}</DialogDescription>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('refusal.reasonLabel')}</span>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value as RefusalReason)}
              data-testid="refusal-reason"
            >
              {REFUSAL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`refusal.reasons.${r}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              {t('refusal.notesLabel')}
              {reason === 'other' && <span className="ml-1 text-destructive">*</span>}
            </span>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder={t('refusal.notesPlaceholder') ?? ''}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="refusal-notes"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {notes.trim().length}/500
              {reason === 'other' && ' — ' + t('refusal.notesRequiredHint')}
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('refusal.cancel')}
            </Button>
            <Button
              disabled={!canSubmit}
              onClick={() =>
                markRefused.mutate({
                  surgeryId,
                  refusalReason: reason,
                  refusalNotes: notes.trim().length > 0 ? notes.trim() : null,
                })
              }
              data-testid="refusal-submit"
            >
              {t('refusal.submit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
