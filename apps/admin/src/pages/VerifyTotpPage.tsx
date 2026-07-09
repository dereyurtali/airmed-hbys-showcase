import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate } from 'react-router-dom';
import { z } from 'zod';
import { CenteredCard } from '../components/CenteredCard';
import { Alert, Button, Field, Input } from '../components/ui';
import { ApiError } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';

export function VerifyTotpPage() {
  const { state, verifyTotp } = usePlatformAuth();
  const t = useT();
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const codeSchema = useMemo(
    () => z.object({ code: z.string().regex(/^\d{6}$/, t('auth.totpInvalid')) }),
    [t],
  );
  const recoverySchema = useMemo(
    () => z.object({ recoveryCode: z.string().min(8, t('auth.recoveryTooShort')).max(40) }),
    [t],
  );

  const codeForm = useForm<{ code: string }>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '' },
  });
  const recoveryForm = useForm<{ recoveryCode: string }>({
    resolver: zodResolver(recoverySchema),
    defaultValues: { recoveryCode: '' },
  });

  if (state.status === 'logged_out') return <Navigate to="/login" replace />;
  if (state.status === 'authenticated') return <Navigate to="/" replace />;
  if (state.status === 'bootstrapping') return null;
  if (state.needsTotpSetup) return <Navigate to="/setup-totp" replace />;

  const onSubmitCode = codeForm.handleSubmit(async ({ code }) => {
    setSubmitError(null);
    try {
      await verifyTotp({ code });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : t('auth.totpVerifyFailed'));
    }
  });

  const onSubmitRecovery = recoveryForm.handleSubmit(async ({ recoveryCode }) => {
    setSubmitError(null);
    try {
      await verifyTotp({ recoveryCode });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : t('auth.recoveryVerifyFailed'));
    }
  });

  return (
    <CenteredCard
      title={t('auth.totpTitle')}
      subtitle={mode === 'code' ? t('auth.totpSubtitleCode') : t('auth.totpSubtitleRecovery')}
    >
      {mode === 'code' ? (
        <form onSubmit={onSubmitCode} className="space-y-4">
          <Field
            label={t('auth.totpCodeLabel')}
            htmlFor="code"
            error={codeForm.formState.errors.code?.message}
          >
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              className="h-11 text-center text-lg tracking-[0.3em]"
              aria-invalid={!!codeForm.formState.errors.code}
              data-testid="platform-totp-code"
              {...codeForm.register('code')}
            />
          </Field>
          {submitError && (
            <Alert tone="error" testId="platform-verify-error">
              {submitError}
            </Alert>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={codeForm.formState.isSubmitting}
            data-testid="platform-totp-submit"
          >
            {codeForm.formState.isSubmitting ? t('auth.totpVerifying') : t('auth.totpVerify')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setMode('recovery');
              setSubmitError(null);
            }}
          >
            {t('auth.useRecovery')}
          </Button>
        </form>
      ) : (
        <form onSubmit={onSubmitRecovery} className="space-y-4">
          <Field
            label={t('auth.recoveryLabel')}
            htmlFor="recoveryCode"
            error={recoveryForm.formState.errors.recoveryCode?.message}
          >
            <Input
              id="recoveryCode"
              type="text"
              autoFocus
              className="h-11"
              aria-invalid={!!recoveryForm.formState.errors.recoveryCode}
              data-testid="platform-recovery-code"
              {...recoveryForm.register('recoveryCode')}
            />
          </Field>
          {submitError && <Alert tone="error">{submitError}</Alert>}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={recoveryForm.formState.isSubmitting}
          >
            {recoveryForm.formState.isSubmitting
              ? t('auth.totpVerifying')
              : t('auth.recoverySubmit')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setMode('code');
              setSubmitError(null);
            }}
          >
            {t('auth.backToTotp')}
          </Button>
        </form>
      )}
    </CenteredCard>
  );
}
