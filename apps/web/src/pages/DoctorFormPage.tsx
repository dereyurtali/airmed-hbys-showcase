import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TRPCClientError } from '@trpc/client';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FormField } from '../components/form/FormField';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  DOCTOR_TYPES,
  SPECIALTY_SUGGESTIONS,
  doctorFormSchema,
  emptyDoctorForm,
  toApiPayload,
  type DoctorFormValues,
} from '../lib/doctor.schemas';
import { trpc } from '../lib/trpc';

interface DoctorFormPageProps {
  mode: 'create' | 'edit';
}

export function DoctorFormPage({ mode }: DoctorFormPageProps) {
  const { t } = useTranslation(['doctor', 'common']);
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const utils = trpc.useUtils();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const detail = trpc.doctor.findById.useQuery(
    { id: params.id ?? '' },
    { enabled: mode === 'edit' && !!params.id },
  );

  // #1149 — Hesaplı doktorun kimlik/klinik-idari alanları hesap üzerinden
  // yönetilir. Bu forma yalnız profil-only (login'siz sevk/dış) doktor girer;
  // hesaplı doktor edit rotasına düşerse Kullanıcı detayına yönlendir.
  useEffect(() => {
    if (mode === 'edit' && detail.data?.userId) {
      navigate(`/admin/users/${detail.data.userId}`, { replace: true });
    }
  }, [mode, detail.data, navigate]);

  const form = useForm<DoctorFormValues>({
    resolver: zodResolver(doctorFormSchema),
    defaultValues: emptyDoctorForm,
  });

  useEffect(() => {
    if (mode !== 'edit' || !detail.data) return;
    form.reset({
      name: detail.data.name,
      specialty: detail.data.specialty,
      type: detail.data.type,
      contactPhone: detail.data.contactPhone ?? '',
      contactEmail: detail.data.contactEmail ?? '',
      commissionRate: detail.data.commissionRate?.toString() ?? '',
      isActive: detail.data.isActive,
      notes: detail.data.notes ?? '',
    });
  }, [mode, detail.data, form]);

  const create = trpc.doctor.create.useMutation({
    onSuccess: async (created) => {
      await utils.doctor.list.invalidate();
      navigate(`/doctors/${created.id}`);
    },
    onError: (err) => {
      setSubmitError(err instanceof TRPCClientError ? err.message : t('doctor:form.errors.create'));
    },
  });

  const update = trpc.doctor.update.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.doctor.list.invalidate(), utils.doctor.findById.invalidate()]);
      navigate(`/doctors/${params.id}`);
    },
    onError: (err) => {
      setSubmitError(err instanceof TRPCClientError ? err.message : t('doctor:form.errors.update'));
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setSubmitError(null);
    const payload = toApiPayload(values);
    if (mode === 'create') {
      create.mutate(payload);
    } else if (params.id) {
      update.mutate({ id: params.id, data: payload });
    }
  });

  const isSubmitting = create.isPending || update.isPending;
  const title = mode === 'create' ? t('doctor:form.createTitle') : t('doctor:form.editTitle');

  const typeLabel = (type: 'local' | 'visiting' | 'referral'): string => {
    if (type === 'local') return t('doctor:type.local');
    if (type === 'visiting') return t('doctor:type.visiting');
    return t('doctor:type.referral');
  };

  if (mode === 'edit' && detail.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} />
        <p className="text-sm text-muted-foreground">{t('common:states.loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={t('doctor:form.description')} />

      <form onSubmit={onSubmit} className="max-w-2xl space-y-5" noValidate>
        <FormField
          label={t('doctor:form.fields.name')}
          required
          error={form.formState.errors.name?.message}
        >
          <Input autoFocus autoComplete="name" {...form.register('name')} />
        </FormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label={t('doctor:form.fields.specialty')}
            required
            description={t('doctor:form.fields.specialtyHint')}
            error={form.formState.errors.specialty?.message}
          >
            <Input list="doctor-specialty-list" {...form.register('specialty')} />
            <datalist id="doctor-specialty-list">
              {SPECIALTY_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </FormField>

          <FormField
            label={t('doctor:form.fields.type')}
            required
            error={form.formState.errors.type?.message}
          >
            <select
              {...form.register('type')}
              className="focus-ring flex h-10 w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
            >
              {DOCTOR_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {typeLabel(type.value)}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label={t('doctor:form.fields.phone')}
            error={form.formState.errors.contactPhone?.message}
          >
            <Input type="tel" autoComplete="tel" {...form.register('contactPhone')} />
          </FormField>

          <FormField
            label={t('doctor:form.fields.email')}
            error={form.formState.errors.contactEmail?.message}
          >
            <Input type="email" autoComplete="email" {...form.register('contactEmail')} />
          </FormField>
        </div>

        <FormField
          label={t('doctor:form.fields.commission')}
          description={t('doctor:form.fields.commissionHint')}
          error={form.formState.errors.commissionRate?.message}
        >
          <Input
            type="number"
            min={0}
            max={100}
            step="0.01"
            inputMode="decimal"
            placeholder={t('doctor:form.fields.commissionPlaceholder')}
            {...form.register('commissionRate')}
          />
        </FormField>

        <FormField
          label={t('doctor:form.fields.notes')}
          error={form.formState.errors.notes?.message}
        >
          <textarea
            {...form.register('notes')}
            rows={3}
            className="focus-ring flex min-h-[60px] w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
          />
        </FormField>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...form.register('isActive')} />
          <span>{t('doctor:form.fields.isActive')}</span>
        </label>

        {submitError && (
          <div
            role="alert"
            className="rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm text-critical-foreground"
          >
            {submitError}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'create' ? t('doctor:form.submitCreate') : t('doctor:form.submitUpdate')}
          </Button>
          <Button asChild variant="outline" type="button">
            <Link to={mode === 'edit' && params.id ? `/doctors/${params.id}` : '/doctors'}>
              {t('common:actions.cancel')}
            </Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
