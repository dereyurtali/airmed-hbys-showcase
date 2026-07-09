import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ImageUp,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BRAND_GRADIENT, BRAND_MESH_BACKGROUND } from '../lib/brand';
import { APP_VERSION_LABEL } from '../lib/version';
import { FormField } from '../components/form/FormField';
import { LocaleSwitcher } from '../components/layout/LocaleSwitcher';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { api, readApiError } from '../lib/api';

const LOGO_ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const SUPPORTED_TIMEZONES = [
  'Asia/Dushanbe',
  'Asia/Tashkent',
  'Asia/Bishkek',
  'Asia/Almaty',
  'Europe/Istanbul',
  'Europe/Moscow',
  'UTC',
] as const;

type SupportedTimezone = (typeof SUPPORTED_TIMEZONES)[number];

interface SetupStatus {
  needsSetup: boolean;
}

export function SetupPage() {
  const { t } = useTranslation(['setup', 'common']);
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2>(1);
  const [statusChecked, setStatusChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const handleLogoPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!LOGO_ALLOWED_MIMES.includes(file.type.toLowerCase())) {
      toast.error(t('setup:clinic.logoErrorMime'));
      if (logoInputRef.current) logoInputRef.current.value = '';
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error(t('setup:clinic.logoErrorSize'));
      if (logoInputRef.current) logoInputRef.current.value = '';
      return;
    }
    setLogoFile(file);
  };

  const clearLogo = () => {
    setLogoFile(null);
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  // Form schema'lar — TR mesajlarıyla; backend de aynı kuralları enforce eder.
  const step1Schema = useMemo(
    () =>
      z.object({
        slug: z.string().regex(/^[a-z0-9-]{3,40}$/, t('setup:validation.slugPattern')),
        clinicName: z.string().min(2, t('setup:validation.nameMin')).max(200),
        mrnPrefix: z.string().regex(/^[A-Z]{2,3}$/, t('setup:validation.mrnPattern')),
        locale: z.enum(['tr', 'ru', 'tg']),
        timezone: z.enum(SUPPORTED_TIMEZONES),
      }),
    [t],
  );

  const step2Schema = useMemo(
    () =>
      z
        .object({
          adminName: z.string().min(2, t('setup:validation.nameMin')).max(100),
          adminEmail: z.string().email(t('setup:validation.emailInvalid')).max(255),
          adminPassword: z.string().min(12, t('setup:validation.passwordMin')).max(200),
          adminPasswordConfirm: z.string(),
        })
        .refine((v) => v.adminPassword === v.adminPasswordConfirm, {
          path: ['adminPasswordConfirm'],
          message: t('setup:validation.passwordMismatch'),
        }),
    [t],
  );

  type Step1Values = z.infer<typeof step1Schema>;
  type Step2Values = z.infer<typeof step2Schema>;

  const step1Form = useForm<Step1Values>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      slug: '',
      clinicName: '',
      mrnPrefix: '',
      locale: 'tr',
      timezone: 'Asia/Dushanbe',
    },
  });

  const step2Form = useForm<Step2Values>({
    resolver: zodResolver(step2Schema),
    defaultValues: {
      adminName: '',
      adminEmail: '',
      adminPassword: '',
      adminPasswordConfirm: '',
    },
  });

  // İlk mount — DB'de zaten kullanıcı varsa setup'ı atlat. Bu sayfa yanlışlıkla
  // URL ile açıldığında login'e yönlendirir; bir saldırgan setup endpoint'ini
  // direkt çağırsa zaten backend 409 atar (race-safe transaction guard).
  useEffect(() => {
    let cancelled = false;
    api
      .get<SetupStatus>('/setup/status')
      .then((res) => {
        if (cancelled) return;
        if (!res.data.needsSetup) {
          navigate('/login', { replace: true, state: { reason: 'alreadySetUp' } });
          return;
        }
        setStatusChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Status fetch başarısızsa form'u yine de göster — submit sırasında
        // backend kesin son sözü verir. Login'e zorla atmamak daha kullanışlı.
        setStatusChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const onStep1Submit = step1Form.handleSubmit(() => {
    setStep(2);
  });

  const onStep2Submit = step2Form.handleSubmit(async (step2Values) => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const step1Values = step1Form.getValues();
      const payload = {
        slug: step1Values.slug,
        clinicName: step1Values.clinicName,
        mrnPrefix: step1Values.mrnPrefix,
        locale: step1Values.locale,
        timezone: step1Values.timezone,
        adminName: step2Values.adminName,
        adminEmail: step2Values.adminEmail,
        adminPassword: step2Values.adminPassword,
      };
      if (logoFile) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(payload)) fd.append(k, v);
        fd.append('logo', logoFile);
        await api.post('/setup/bootstrap', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        await api.post('/setup/bootstrap', payload);
      }
      setSuccess(true);
    } catch (err) {
      setSubmitError(readApiError(err));
    } finally {
      setSubmitting(false);
    }
  });

  if (!statusChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" strokeWidth={1.5} />
      </div>
    );
  }

  // Sürüm package.json'dan (lib/version); kanal etiketi ("Demo") çevrilebilir.
  // Setup login'le aynı "Quiet Split" auth yüzeyini paylaşır (§24.2).
  const channel = t('common:app.versionChannel', { defaultValue: '' });
  const versionLabel = channel ? `${APP_VERSION_LABEL} · ${channel}` : APP_VERSION_LABEL;

  return (
    <div className="min-h-screen bg-muted/30 lg:grid lg:grid-cols-[40%_60%]">
      {/* Sol panel — login ile birebir aynı "Quiet Split" marka yüzeyi (§24.2):
          gradient + 11px mesh + monokrom beyaz logo + tagline. */}
      <aside
        className={`relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:p-12 ${BRAND_GRADIENT}`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.10]"
          style={{ backgroundImage: BRAND_MESH_BACKGROUND }}
        />

        <div className="relative flex flex-1 flex-col items-center justify-center text-center">
          <img
            src="/airmed-logo-light.png"
            alt="AirMed"
            className="h-16 w-auto select-none [filter:brightness(0)_invert(1)] xl:h-20"
            draggable={false}
          />

          <p className="mt-6 max-w-xs text-base leading-relaxed text-white/70">
            {t('common:app.tagline')}
          </p>
        </div>

        <div className="relative flex items-center justify-between text-xs text-white/55">
          <span>{t('common:app.footer')}</span>
          <span className="font-medium tracking-wide text-white/70">{versionLabel}</span>
        </div>
      </aside>

      <main className="flex min-h-screen items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-xl space-y-5">
          <div className="flex items-center justify-between">
            <img
              src="/airmed-logo.png"
              alt="AirMed"
              className="h-7 w-auto select-none lg:hidden"
              draggable={false}
            />
            <div className="ml-auto">
              <LocaleSwitcher />
            </div>
          </div>

          <div className="rounded-xl border bg-background p-6 shadow-sm sm:p-8">
            {success ? (
              <SuccessPanel onContinue={() => navigate('/login', { replace: true })} />
            ) : (
              <>
                <header className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                    <span>{t('setup:stepLabel', { current: step, total: 2 })}</span>
                  </div>
                  <h2 className="text-2xl font-bold tracking-tight">{t('setup:title')}</h2>
                  <p className="text-sm text-muted-foreground">{t('setup:subtitle')}</p>
                </header>

                <Stepper current={step} />

                {step === 1 ? (
                  <form
                    onSubmit={onStep1Submit}
                    className="mt-6 space-y-4"
                    noValidate
                    data-testid="setup-step1"
                  >
                    <p className="text-sm text-muted-foreground">{t('setup:clinic.intro')}</p>

                    <FormField
                      label={t('setup:clinic.slugLabel')}
                      description={t('setup:clinic.slugHint')}
                      required
                      error={step1Form.formState.errors.slug?.message}
                    >
                      <Input
                        autoFocus
                        autoComplete="off"
                        placeholder="demoeye-dushanbe"
                        data-testid="setup-slug"
                        {...step1Form.register('slug')}
                      />
                    </FormField>

                    <FormField
                      label={t('setup:clinic.nameLabel')}
                      description={t('setup:clinic.nameHint')}
                      required
                      error={step1Form.formState.errors.clinicName?.message}
                    >
                      <Input
                        autoComplete="organization"
                        placeholder="DemoEye Clinic"
                        data-testid="setup-clinic-name"
                        {...step1Form.register('clinicName')}
                      />
                    </FormField>

                    <FormField
                      label={t('setup:clinic.mrnPrefixLabel')}
                      description={t('setup:clinic.mrnPrefixHint')}
                      required
                      error={step1Form.formState.errors.mrnPrefix?.message}
                    >
                      <Input
                        autoComplete="off"
                        placeholder="TD"
                        maxLength={3}
                        className="uppercase"
                        data-testid="setup-mrn-prefix"
                        {...step1Form.register('mrnPrefix')}
                      />
                    </FormField>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        label={t('setup:clinic.localeLabel')}
                        required
                        error={step1Form.formState.errors.locale?.message}
                      >
                        <select
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          data-testid="setup-locale"
                          {...step1Form.register('locale')}
                        >
                          <option value="tr">{t('setup:locales.tr')}</option>
                          <option value="ru">{t('setup:locales.ru')}</option>
                          <option value="tg">{t('setup:locales.tg')}</option>
                        </select>
                      </FormField>

                      <FormField
                        label={t('setup:clinic.timezoneLabel')}
                        required
                        error={step1Form.formState.errors.timezone?.message}
                      >
                        <select
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          data-testid="setup-timezone"
                          {...step1Form.register('timezone')}
                        >
                          {SUPPORTED_TIMEZONES.map((tz: SupportedTimezone) => (
                            <option key={tz} value={tz}>
                              {tz}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    </div>

                    <FormField
                      label={t('setup:clinic.logoLabel')}
                      description={t('setup:clinic.logoHint')}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
                          {logoPreview ? (
                            <img
                              src={logoPreview}
                              alt="logo preview"
                              className="h-full w-full object-contain p-1"
                            />
                          ) : (
                            <img
                              src="/airmed-logo.png"
                              alt="AirMed default"
                              className="h-full w-full object-contain p-1.5 opacity-70"
                              draggable={false}
                            />
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <input
                            ref={logoInputRef}
                            type="file"
                            accept={LOGO_ALLOWED_MIMES.join(',')}
                            onChange={handleLogoPick}
                            className="hidden"
                            data-testid="setup-logo-input"
                          />
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => logoInputRef.current?.click()}
                              data-testid="setup-logo-pick"
                            >
                              <ImageUp className="mr-2 h-4 w-4" strokeWidth={1.5} />
                              {logoFile
                                ? t('setup:clinic.logoReplace')
                                : t('setup:clinic.logoPick')}
                            </Button>
                            {logoFile && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={clearLogo}
                                data-testid="setup-logo-clear"
                              >
                                <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.5} />
                                {t('setup:clinic.logoClear')}
                              </Button>
                            )}
                          </div>
                          {logoFile && (
                            <span className="truncate text-xs text-muted-foreground">
                              {logoFile.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </FormField>

                    <div className="flex justify-end pt-2">
                      <Button type="submit" data-testid="setup-next">
                        {t('setup:actions.next')}
                        <ArrowRight className="ml-2 h-4 w-4" strokeWidth={1.5} aria-hidden />
                      </Button>
                    </div>
                  </form>
                ) : (
                  <form
                    onSubmit={onStep2Submit}
                    className="mt-6 space-y-4"
                    noValidate
                    data-testid="setup-step2"
                  >
                    <p className="text-sm text-muted-foreground">{t('setup:admin.intro')}</p>

                    <FormField
                      label={t('setup:admin.nameLabel')}
                      required
                      error={step2Form.formState.errors.adminName?.message}
                    >
                      <Input
                        autoFocus
                        autoComplete="name"
                        data-testid="setup-admin-name"
                        {...step2Form.register('adminName')}
                      />
                    </FormField>

                    <FormField
                      label={t('setup:admin.emailLabel')}
                      required
                      error={step2Form.formState.errors.adminEmail?.message}
                    >
                      <Input
                        type="email"
                        autoComplete="email"
                        data-testid="setup-admin-email"
                        {...step2Form.register('adminEmail')}
                      />
                    </FormField>

                    <FormField
                      label={t('setup:admin.passwordLabel')}
                      description={t('setup:admin.passwordHint')}
                      required
                      error={step2Form.formState.errors.adminPassword?.message}
                    >
                      <Input
                        type="password"
                        autoComplete="new-password"
                        data-testid="setup-admin-password"
                        {...step2Form.register('adminPassword')}
                      />
                    </FormField>

                    <FormField
                      label={t('setup:admin.passwordConfirmLabel')}
                      required
                      error={step2Form.formState.errors.adminPasswordConfirm?.message}
                    >
                      <Input
                        type="password"
                        autoComplete="new-password"
                        data-testid="setup-admin-password-confirm"
                        {...step2Form.register('adminPasswordConfirm')}
                      />
                    </FormField>

                    {submitError && (
                      <div
                        role="alert"
                        data-testid="setup-error"
                        className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                      >
                        <AlertCircle
                          className="mt-0.5 h-4 w-4 shrink-0"
                          strokeWidth={1.5}
                          aria-hidden
                        />
                        <span className="leading-snug">{submitError}</span>
                      </div>
                    )}

                    <div className="flex justify-between pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setStep(1)}
                        disabled={submitting}
                        data-testid="setup-back"
                      >
                        <ArrowLeft className="mr-2 h-4 w-4" strokeWidth={1.5} aria-hidden />
                        {t('setup:actions.back')}
                      </Button>
                      <Button type="submit" disabled={submitting} data-testid="setup-submit">
                        {submitting ? (
                          <>
                            <Loader2
                              className="mr-2 h-4 w-4 animate-spin"
                              strokeWidth={1.5}
                              aria-hidden
                            />
                            {t('setup:actions.submitting')}
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="mr-2 h-4 w-4" strokeWidth={1.5} aria-hidden />
                            {t('setup:actions.submit')}
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                )}
              </>
            )}
          </div>

          <p className="text-center text-xs text-muted-foreground lg:hidden">
            {t('common:app.footer')} · {versionLabel}
          </p>
        </div>
      </main>
    </div>
  );
}

function Stepper({ current }: { current: 1 | 2 }) {
  const { t } = useTranslation('setup');
  const steps: Array<{ idx: 1 | 2; label: string }> = [
    { idx: 1, label: t('setup:stepClinic') },
    { idx: 2, label: t('setup:stepAdmin') },
  ];
  return (
    <ol className="mt-5 flex items-center gap-3" aria-label="setup progress">
      {steps.map((step, i) => {
        const isActive = step.idx === current;
        const isDone = step.idx < current;
        return (
          <li key={step.idx} className="flex flex-1 items-center gap-2">
            <span
              aria-current={isActive ? 'step' : undefined}
              className={
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ' +
                (isDone
                  ? 'border-primary bg-primary text-primary-foreground'
                  : isActive
                    ? 'border-primary text-primary'
                    : 'border-muted-foreground/30 text-muted-foreground')
              }
            >
              {isDone ? <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} /> : step.idx}
            </span>
            <span
              className={
                'truncate text-xs ' +
                (isActive ? 'font-medium text-foreground' : 'text-muted-foreground')
              }
            >
              {step.label}
            </span>
            {i < steps.length - 1 && <span aria-hidden className="ml-1 h-px flex-1 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

function SuccessPanel({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation('setup');
  return (
    <div className="space-y-5 text-center" data-testid="setup-success">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
        <CheckCircle2 className="h-8 w-8" strokeWidth={1.5} aria-hidden />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-2xl font-bold tracking-tight">{t('setup:successTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('setup:successDescription')}</p>
      </div>
      <Button onClick={onContinue} className="w-full" data-testid="setup-success-cta">
        {t('setup:successCta')}
      </Button>
    </div>
  );
}
