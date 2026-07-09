import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FormField } from '../components/form/FormField';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { api, readApiError } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';

export function ChangePasswordPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { mustChangePassword, clearMustChangePassword } = useAuth();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const changePasswordSchema = z
    .object({
      currentPassword: z.string().min(8, t('auth:changePassword.validation.currentMin')),
      newPassword: z.string().min(8, t('auth:changePassword.validation.newMin')),
      confirmPassword: z.string().min(8),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      path: ['confirmPassword'],
      message: t('auth:changePassword.validation.confirmMismatch'),
    })
    .refine((data) => data.currentPassword !== data.newPassword, {
      path: ['newPassword'],
      message: t('auth:changePassword.validation.sameAsCurrent'),
    });

  type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      clearMustChangePassword();
      setSuccess(true);
      setTimeout(() => navigate('/', { replace: true }), 1200);
    } catch (err) {
      setSubmitError(readApiError(err));
    }
  });

  const isSubmitting = form.formState.isSubmitting;

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title={t('auth:changePassword.title')}
        description={
          mustChangePassword
            ? t('auth:changePassword.descriptionFirstLogin')
            : t('auth:changePassword.descriptionStandard')
        }
      />

      <div className="rounded-md border bg-background p-6">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField
            label={t('auth:changePassword.currentLabel')}
            required
            error={form.formState.errors.currentPassword?.message}
          >
            <Input
              type="password"
              autoComplete="current-password"
              {...form.register('currentPassword')}
            />
          </FormField>

          <FormField
            label={t('auth:changePassword.newLabel')}
            required
            error={form.formState.errors.newPassword?.message}
          >
            <Input type="password" autoComplete="new-password" {...form.register('newPassword')} />
          </FormField>

          <FormField
            label={t('auth:changePassword.confirmLabel')}
            required
            error={form.formState.errors.confirmPassword?.message}
          >
            <Input
              type="password"
              autoComplete="new-password"
              {...form.register('confirmPassword')}
            />
          </FormField>

          {submitError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {submitError}
            </div>
          )}

          {success && (
            <div
              role="status"
              className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900"
            >
              {t('auth:changePassword.successMessage')}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button asChild variant="outline" type="button">
              <Link to="/">{t('auth:changePassword.cancel')}</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting || success}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('auth:changePassword.submit')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
