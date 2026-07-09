import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { z } from 'zod';
import { LogoUploadField } from '../components/clinic/LogoUploadField';
import { FormField } from '../components/form/FormField';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';
import { trpc } from '../lib/trpc';

// S17 — Klinik bilgi yönetim ekranı (yönetici-only).
// Form alanları: ad (zorunlu), legalName, address, phone, email, logoUrl,
// taxId. slug + mrnPrefix readonly (subdomain + MRN format immutable).

type ClinicData = {
  slug: string;
  name: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  taxId: string | null;
  mrnPrefix: string;
  scheduling?: {
    defaultAppointmentMinutes?: number | null;
    postOpFreeMonths?: number | null;
  };
  maxApprovableDiscountPercent?: number | null;
};

function toFormValues(data: ClinicData) {
  return {
    name: data.name,
    legalName: data.legalName ?? '',
    address: data.address ?? '',
    phone: data.phone ?? '',
    email: data.email ?? '',
    taxId: data.taxId ?? '',
    defaultAppointmentMinutes:
      data.scheduling?.defaultAppointmentMinutes != null
        ? String(data.scheduling.defaultAppointmentMinutes)
        : '',
    postOpFreeMonths:
      data.scheduling?.postOpFreeMonths != null ? String(data.scheduling.postOpFreeMonths) : '',
    maxApprovableDiscountPercent:
      data.maxApprovableDiscountPercent != null ? String(data.maxApprovableDiscountPercent) : '',
  };
}

export function ClinicSettingsPage() {
  const { t } = useTranslation('common');

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(2, t('clinicSettingsPage.validation.nameMin')).max(255),
        legalName: z.string().trim().max(255).optional().or(z.literal('')),
        address: z.string().trim().max(500).optional().or(z.literal('')),
        phone: z.string().trim().max(50).optional().or(z.literal('')),
        email: z
          .string()
          .trim()
          .email(t('clinicSettingsPage.validation.emailInvalid'))
          .max(255)
          .optional()
          .or(z.literal('')),
        taxId: z.string().trim().max(50).optional().or(z.literal('')),
        defaultAppointmentMinutes: z
          .string()
          .refine(
            (v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 5 && Number(v) <= 240),
            t('clinicSettingsPage.validation.minutesRange'),
          )
          .optional(),
        postOpFreeMonths: z
          .string()
          .refine(
            (v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 0 && Number(v) <= 12),
            t('clinicSettingsPage.validation.monthsRange'),
          )
          .optional(),
        maxApprovableDiscountPercent: z
          .string()
          .refine(
            (v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 0 && Number(v) <= 100),
            t('clinicSettingsPage.validation.discountRange'),
          )
          .optional(),
      }),
    [t],
  );

  type FormValues = z.infer<typeof schema>;

  const query = trpc.clinicSettings.get.useQuery();
  const utils = trpc.useUtils();
  const update = trpc.clinicSettings.update.useMutation({
    onSuccess: () => {
      toast.success(t('clinicSettingsPage.toast.saved'));
      void utils.clinicSettings.get.invalidate();
    },
    onError: (err) => {
      toast.error(
        err instanceof TRPCClientError ? err.message : t('clinicSettingsPage.toast.error'),
      );
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      legalName: '',
      address: '',
      phone: '',
      email: '',
      taxId: '',
      defaultAppointmentMinutes: '',
      postOpFreeMonths: '',
      maxApprovableDiscountPercent: '',
    },
  });

  const data = query.data as ClinicData | undefined;
  useEffect(() => {
    if (!data) return;
    form.reset(toFormValues(data));
  }, [data, form]);

  const onSubmit = form.handleSubmit((values) => {
    const scheduling =
      values.defaultAppointmentMinutes === '' && values.postOpFreeMonths === ''
        ? undefined
        : {
            defaultAppointmentMinutes:
              values.defaultAppointmentMinutes === ''
                ? null
                : Number(values.defaultAppointmentMinutes),
            postOpFreeMonths:
              values.postOpFreeMonths === '' ? null : Number(values.postOpFreeMonths),
          };
    update.mutate({
      name: values.name,
      legalName: values.legalName || null,
      address: values.address || null,
      phone: values.phone || null,
      email: values.email || null,
      taxId: values.taxId || null,
      scheduling,
      maxApprovableDiscountPercent:
        values.maxApprovableDiscountPercent === '' || values.maxApprovableDiscountPercent == null
          ? null
          : Number(values.maxApprovableDiscountPercent),
    });
  });

  const isSubmitting = update.isPending;

  // Loading state — query.isLoading sırasında form boş gösterilirse yönetici
  // bilgileri silinmiş sanıp panik kaydedebilir. Skeleton ile koru.
  if (query.isLoading) {
    return (
      <div className="space-y-6" data-testid="clinic-settings-root">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('clinicSettingsPage.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('clinicSettingsPage.loading')}</p>
        </div>
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl border" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="clinic-settings-root">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('clinicSettingsPage.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('clinicSettingsPage.description')}</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        {/* Kimlik */}
        <Section title={t('clinicSettingsPage.sections.identity')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('clinicSettingsPage.fields.name')}
              required
              error={form.formState.errors.name?.message}
            >
              <Input autoComplete="organization" {...form.register('name')} />
            </FormField>
            <FormField
              label={t('clinicSettingsPage.fields.legalName')}
              error={form.formState.errors.legalName?.message}
            >
              <Input {...form.register('legalName')} />
            </FormField>
            <FormField
              label={t('clinicSettingsPage.fields.slug')}
              description={t('clinicSettingsPage.hints.slug')}
            >
              <Input readOnly className="bg-muted/40" value={data?.slug ?? ''} />
            </FormField>
          </div>
        </Section>

        {/* İletişim */}
        <Section title={t('clinicSettingsPage.sections.contact')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('clinicSettingsPage.fields.address')}
              error={form.formState.errors.address?.message}
            >
              <Input autoComplete="street-address" {...form.register('address')} />
            </FormField>
            <FormField
              label={t('clinicSettingsPage.fields.phone')}
              error={form.formState.errors.phone?.message}
            >
              <Input type="tel" autoComplete="tel" {...form.register('phone')} />
            </FormField>
            <FormField
              label={t('clinicSettingsPage.fields.email')}
              error={form.formState.errors.email?.message}
            >
              <Input type="email" autoComplete="email" {...form.register('email')} />
            </FormField>
          </div>
        </Section>

        {/* Marka */}
        <Section title={t('clinicSettingsPage.sections.branding')}>
          <LogoUploadField
            logoUrl={data?.logoUrl ?? null}
            onChanged={() => void utils.clinicSettings.get.invalidate()}
          />
        </Section>

        {/* Resmi */}
        <Section title={t('clinicSettingsPage.sections.legal')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('clinicSettingsPage.fields.taxId')}
              error={form.formState.errors.taxId?.message}
            >
              <Input {...form.register('taxId')} />
            </FormField>
            <FormField
              label={t('clinicSettingsPage.fields.mrnPrefix')}
              description={t('clinicSettingsPage.hints.mrnPrefix')}
            >
              <Input readOnly className="bg-muted/40" value={data?.mrnPrefix ?? ''} />
            </FormField>
          </div>
        </Section>

        {/* Randevu ayarları (Madde 1 + 4) */}
        <Section title={t('clinicSettingsPage.sections.scheduling')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('clinicSettingsPage.fields.defaultAppointmentMinutes')}
              description={t('clinicSettingsPage.hints.defaultAppointmentMinutes')}
              error={form.formState.errors.defaultAppointmentMinutes?.message}
            >
              <Input
                type="number"
                min={5}
                max={240}
                step={5}
                placeholder="30"
                {...form.register('defaultAppointmentMinutes')}
              />
            </FormField>
            <FormField
              label={t('clinicSettingsPage.fields.postOpFreeMonths')}
              description={t('clinicSettingsPage.hints.postOpFreeMonths')}
              error={form.formState.errors.postOpFreeMonths?.message}
            >
              <Input
                type="number"
                min={0}
                max={12}
                step={1}
                placeholder="0"
                {...form.register('postOpFreeMonths')}
              />
            </FormField>
          </div>
        </Section>

        {/* İndirim politikası (#361) — mutlak tavan */}
        <Section title={t('clinicSettingsPage.sections.discountPolicy')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('clinicSettingsPage.fields.maxApprovableDiscountPercent')}
              description={t('clinicSettingsPage.hints.maxApprovableDiscountPercent')}
              error={form.formState.errors.maxApprovableDiscountPercent?.message}
            >
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                placeholder="30"
                {...form.register('maxApprovableDiscountPercent')}
              />
            </FormField>
          </div>
        </Section>

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => data && form.reset(toFormValues(data))}
            disabled={isSubmitting || !data}
          >
            {t('clinicSettingsPage.actions.reset')}
          </Button>
          <Button type="submit" disabled={isSubmitting || !data} data-testid="clinic-settings-save">
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} />
            ) : (
              <Save className="mr-2 h-4 w-4" strokeWidth={1.5} />
            )}
            {isSubmitting
              ? t('clinicSettingsPage.actions.saving')
              : t('clinicSettingsPage.actions.save')}
          </Button>
        </div>
      </form>

      {/* #1159 — Lobi bekleme ekranı (Raspberry Pi kiosk) yayın bağlantısı.
          Form dışında (kendi mutation'ları var). */}
      <PublicMonitorSection />
    </div>
  );
}

// #1159 — Yönetici: lobi bekleme ekranı yayın anahtarını üret/döndür/kapat.
// Üretilen kiosk URL'i (origin + /public-monitor?key=…) BİR KEZ gösterilir.
function PublicMonitorSection() {
  const { t } = useTranslation('common');
  const utils = trpc.useUtils();
  const status = trpc.clinicSettings.publicMonitorStatus.useQuery();
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const enabled = status.data?.enabled ?? false;

  const generate = trpc.clinicSettings.generatePublicMonitorKey.useMutation({
    onSuccess: ({ key }) => {
      setGeneratedUrl(`${window.location.origin}/public-monitor?key=${key}`);
      void utils.clinicSettings.publicMonitorStatus.invalidate();
      toast.success(t('publicMonitorSection.generated'));
    },
    onError: () => toast.error(t('publicMonitorSection.error')),
  });
  const disable = trpc.clinicSettings.disablePublicMonitorKey.useMutation({
    onSuccess: () => {
      setGeneratedUrl(null);
      void utils.clinicSettings.publicMonitorStatus.invalidate();
      toast.success(t('publicMonitorSection.disabled'));
    },
    onError: () => toast.error(t('publicMonitorSection.error')),
  });

  const copy = async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      toast.success(t('publicMonitorSection.copied'));
    } catch {
      /* clipboard yok — kullanıcı elle kopyalar */
    }
  };

  return (
    <Section title={t('clinicSettingsPage.sections.publicMonitor')}>
      <p className="text-sm text-muted-foreground">{t('publicMonitorSection.description')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span
          className={cn(
            'inline-flex items-center rounded-badge px-2.5 py-0.5 text-xs font-medium',
            enabled
              ? 'border border-success-border bg-success-bg text-success-foreground'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {enabled ? t('publicMonitorSection.statusOn') : t('publicMonitorSection.statusOff')}
        </span>
        <Button type="button" onClick={() => generate.mutate()} disabled={generate.isPending}>
          {enabled ? t('publicMonitorSection.regenerate') : t('publicMonitorSection.generate')}
        </Button>
        {enabled && (
          <Button
            type="button"
            variant="outline"
            onClick={() => disable.mutate()}
            disabled={disable.isPending}
          >
            {t('publicMonitorSection.disable')}
          </Button>
        )}
      </div>
      {generatedUrl && (
        <div className="mt-4 rounded-lg border border-warning-border bg-warning-bg p-4">
          <p className="text-sm font-medium text-warning-foreground">
            {t('publicMonitorSection.copyOnce')}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-3 py-2 text-xs">
              {generatedUrl}
            </code>
            <Button type="button" variant="outline" onClick={copy}>
              {t('publicMonitorSection.copy')}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-background p-5 sm:p-6">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
