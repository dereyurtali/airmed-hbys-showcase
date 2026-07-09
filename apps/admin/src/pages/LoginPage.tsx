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

export function LoginPage() {
  const { state, login } = usePlatformAuth();
  const t = useT();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const schema = useMemo(
    () =>
      z.object({
        email: z.string().email(t('auth.invalidEmail')),
        password: z.string().min(8, t('auth.passwordMin')),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  if (state.status === 'authenticated') return <Navigate to="/" replace />;
  if (state.status === 'challenge') {
    return <Navigate to={state.needsTotpSetup ? '/setup-totp' : '/verify-totp'} replace />;
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await login(values.email, values.password);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) setSubmitError(t('auth.tooManyAttempts'));
        else setSubmitError(err.message);
      } else {
        setSubmitError(t('auth.loginFailed'));
      }
    }
  });

  const isSubmitting = form.formState.isSubmitting;

  return (
    <CenteredCard
      title={t('auth.loginTitle')}
      subtitle={t('auth.loginSubtitle')}
      footer={
        <>
          {t('auth.loginFooterPrefix')}{' '}
          <a
            href="https://hbys.dnasoft.co"
            className="text-primary underline-offset-2 hover:underline"
          >
            hbys.dnasoft.co
          </a>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t('auth.email')} htmlFor="email" error={form.formState.errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            className="h-11"
            aria-invalid={!!form.formState.errors.email}
            data-testid="platform-login-email"
            {...form.register('email')}
          />
        </Field>
        <Field
          label={t('auth.password')}
          htmlFor="password"
          error={form.formState.errors.password?.message}
        >
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            className="h-11"
            aria-invalid={!!form.formState.errors.password}
            data-testid="platform-login-password"
            {...form.register('password')}
          />
        </Field>
        {submitError && (
          <Alert tone="error" testId="platform-login-error">
            {submitError}
          </Alert>
        )}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={isSubmitting}
          data-testid="platform-login-submit"
        >
          {isSubmitting ? t('auth.loginSubmitting') : t('auth.loginSubmit')}
        </Button>
      </form>
    </CenteredCard>
  );
}
