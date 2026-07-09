import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useT } from '../i18n';
import { Alert, Button, Field, Modal, Textarea } from './ui';
import { cn } from '../lib/cn';
import type { ImpersonationStartResponse, TenantUserRow } from '../lib/impersonation-types';

interface Props {
  accessToken: string;
  user: TenantUserRow;
  onClose: () => void;
  onSuccess: (resp: ImpersonationStartResponse) => void;
}

// F7 — Impersonation start modal.
//
// Plan kuralları:
// - Reason mandatory, 10+ char
// - Duration radio: 15 / 30 / 60 dk
// - Hedef kullanıcı bilgileri görünür (yanlış kullanıcıya basmamak için
//   ekstra confirmation katmanı — airmed-design Ray 1)
export function ImpersonateDialog({ accessToken, user, onClose, onSuccess }: Props) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState<15 | 30 | 60>(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonTooShort = reason.trim().length < 10;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reasonTooShort) {
      setError(t('impersonateDialog.reasonTooShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const resp = await api<ImpersonationStartResponse>('/platform/impersonate', {
        method: 'POST',
        bearer: accessToken,
        body: { targetUserId: user.id, reason: reason.trim(), durationMin: duration },
      });
      onSuccess(resp);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('impersonateDialog.startError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissable={!busy}
      testId="impersonate-dialog"
      labelledBy="impersonate-title"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 id="impersonate-title" className="text-[15px] font-semibold text-foreground">
          {t('impersonateDialog.title')}
        </h2>

        {/* Hedef kimlik — yanlış kullanıcı guardrail */}
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-[13px]">
          <div className="font-medium text-foreground">
            {user.name} <span className="font-normal text-muted-foreground">({user.email})</span>
          </div>
          <div className="mt-0.5 text-muted-foreground">
            {t('impersonateDialog.roles', { roles: user.roles.join(', ') || '—' })}
          </div>
        </div>

        <Field label={t('impersonateDialog.reasonLabel')} htmlFor="impersonate-reason">
          <Textarea
            id="impersonate-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            data-testid="impersonate-reason"
            placeholder={t('impersonateDialog.reasonPlaceholder')}
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-[13px] font-semibold text-foreground">
            {t('impersonateDialog.durationLegend')}
          </legend>
          <div className="flex gap-2">
            {[15, 30, 60].map((d) => (
              <label
                key={d}
                className={cn(
                  'focus-within:ring-2 focus-within:ring-primary/35 flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors',
                  duration === d
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-foreground hover:bg-[var(--hover)]',
                )}
              >
                <input
                  type="radio"
                  name="duration"
                  value={d}
                  checked={duration === d}
                  onChange={() => setDuration(d as 15 | 30 | 60)}
                  className="sr-only"
                  data-testid={`impersonate-duration-${d}`}
                />
                {t('impersonateDialog.durationUnit', { n: d })}
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <Alert tone="error" testId="impersonate-error">
            {error}
          </Alert>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={busy}
            data-testid="impersonate-cancel"
          >
            {t('impersonateDialog.cancel')}
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={reasonTooShort}
            data-testid="impersonate-submit"
          >
            {busy ? t('impersonateDialog.starting') : t('impersonateDialog.start')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
