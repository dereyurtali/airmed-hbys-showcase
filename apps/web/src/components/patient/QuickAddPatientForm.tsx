import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import { z } from 'zod';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DateField } from '../ui/date-field';
import { FormField } from '../form/FormField';
import { PhoneInput } from '../form/PhoneInput';
import { patientFormSchema, LEAD_SOURCES } from '../../lib/patient.schemas';
import { trpc } from '../../lib/trpc';

// Hızlı kayıt yalnız 5 zorunlu (core) alan — gerisi sonra hasta kartından.
const quickAddSchema = patientFormSchema.pick({
  firstName: true,
  lastName: true,
  birthDate: true,
  gender: true,
  phone: true,
  // #378 — Lead kaynağı hızlı-eklemede sorulur (sosyal medya kaynağı kaybolmasın,
  // LeadFunnel raporu dolsun). #375 — second_opinion da seçenekler arasında.
  leadSource: true,
});
type QuickAddValues = z.infer<typeof quickAddSchema>;

interface CreatedPatient {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string;
}

interface DuplicateInfo {
  id: string;
  reason: string;
}

interface Props {
  /** Picker'daki arama metni — ad/soyad alanlarına ön-doldurma için bölünür. */
  initialName?: string;
  onCreated: (patient: CreatedPatient) => void;
  onCancel: () => void;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * Hasta bulunamayınca picker içinde inline açılan hızlı kayıt formu: yalnız 5
 * zorunlu alan. Encounter AÇMAZ — sadece hasta kaydı oluşturup çağırana seçtirir
 * (ileri tarihli randevu = kuyruğa girmez). Mükerrer kayıtta backend 409 + force
 * akışı, PatientFormPage ile aynı sözleşme.
 */
export function QuickAddPatientForm({ initialName, onCreated, onCancel }: Props) {
  const { t } = useTranslation(['appointment', 'patient', 'common']);
  const [duplicates, setDuplicates] = useState<DuplicateInfo[] | null>(null);
  const [pending, setPending] = useState<QuickAddValues | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const initial = splitName(initialName ?? '');
  const form = useForm<QuickAddValues>({
    resolver: zodResolver(quickAddSchema),
    mode: 'onBlur',
    defaultValues: {
      firstName: initial.firstName,
      lastName: initial.lastName,
      birthDate: '',
      // #411 — Cinsiyet sessizce 'Kadın'a düşmesin: boş başlar, kullanıcı seçer
      // (zod enum '' reddeder → required hatası). Yanlış cinsiyet kaydı önlenir.
      gender: '' as QuickAddValues['gender'],
      phone: '',
      leadSource: '',
    },
  });

  // İlk required alan mount'ta focus (klinik hız; autoFocus prop yerine setFocus
  // ile jsx-a11y/no-autofocus uyarısından kaçınılır).
  useEffect(() => {
    form.setFocus('firstName');
  }, [form]);

  const create = trpc.patient.create.useMutation({
    onSuccess: (newPatient) => {
      toast.success(
        t('appointment:quickAdd.created', {
          name: `${newPatient.firstName} ${newPatient.lastName}`,
        }),
      );
      onCreated({
        id: newPatient.id,
        firstName: newPatient.firstName,
        lastName: newPatient.lastName,
        mrn: newPatient.mrn,
      });
    },
    onError: (err) => {
      if (err instanceof TRPCClientError) {
        try {
          const parsed = JSON.parse(err.message) as { duplicates?: DuplicateInfo[] };
          if (parsed.duplicates?.length) {
            setDuplicates(parsed.duplicates);
            return;
          }
        } catch {
          // message JSON değil — genel hata olarak göster
        }
        setSubmitError(err.message);
      } else {
        setSubmitError(t('common:errors.unexpected'));
      }
    },
  });

  const submit = form.handleSubmit((values) => {
    setSubmitError(null);
    setDuplicates(null);
    // #378 — leadSource boşsa undefined gönder (create input enum|null bekler, '' değil).
    const payload = { ...values, leadSource: values.leadSource || undefined };
    setPending(payload);
    create.mutate(payload);
  });

  const onForceCreate = () => {
    if (!pending) return;
    setDuplicates(null);
    create.mutate({ ...pending, leadSource: pending.leadSource || undefined, force: true });
  };

  return (
    // İç içe <form> KULLANMA: bu blok AppointmentDialog'un (ve fatura dialog'unun)
    // <form>'unun içinde render olur. İç içe form geçersiz HTML'dir; "Ekle ve seç"e
    // basınca tarayıcı dış/iç formu native GET ile submit edip sayfayı yeniden
    // yükler (dialog kapanır, URL'e alanlar query string olarak eklenir). Bu yüzden
    // burada <div> + type="button" onClick ile native submit'i tamamen elimine et.
    // Enter ile gönderme klinik hız için elle korunur.
    <div
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          void submit();
        }
      }}
      className="space-y-3 rounded-md border bg-muted/30 p-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t('appointment:quickAdd.title')}</span>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t('appointment:quickAdd.cancel')}
          className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t('appointment:quickAdd.hint')}</p>

      <div className="grid grid-cols-2 gap-2">
        <FormField
          label={t('patient:form.fields.firstName')}
          required
          error={form.formState.errors.firstName?.message}
        >
          <Input {...form.register('firstName')} autoComplete="given-name" />
        </FormField>
        <FormField
          label={t('patient:form.fields.lastName')}
          required
          error={form.formState.errors.lastName?.message}
        >
          <Input {...form.register('lastName')} autoComplete="family-name" />
        </FormField>
        <FormField
          label={t('patient:form.fields.birthDate')}
          required
          error={form.formState.errors.birthDate?.message}
        >
          <Controller
            control={form.control}
            name="birthDate"
            render={({ field }) => (
              <DateField value={field.value ?? ''} onChange={field.onChange} />
            )}
          />
        </FormField>
        <FormField
          label={t('patient:form.fields.gender')}
          required
          error={form.formState.errors.gender?.message}
        >
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...form.register('gender')}
          >
            <option value="" disabled>
              {t('patient:form.fields.genderPlaceholder', { defaultValue: 'Seçin…' })}
            </option>
            <option value="female">{t('patient:gender.female')}</option>
            <option value="male">{t('patient:gender.male')}</option>
            <option value="other">{t('patient:gender.other')}</option>
          </select>
        </FormField>
      </div>

      <FormField
        label={t('patient:form.fields.phone')}
        required
        error={form.formState.errors.phone?.message}
      >
        <PhoneInput
          value={form.watch('phone') ?? ''}
          onChange={(v) => form.setValue('phone', v, { shouldDirty: true, shouldValidate: true })}
          ariaInvalid={!!form.formState.errors.phone}
        />
      </FormField>

      {/* #378 — Lead kaynağı (opsiyonel): sosyal medya kaynağı kaybolmasın. */}
      <FormField label={t('patient:form.fields.leadSource', { defaultValue: 'Geliş kaynağı' })}>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          {...form.register('leadSource')}
        >
          <option value="">—</option>
          {LEAD_SOURCES.map((ls) => (
            <option key={ls} value={ls}>
              {t(`patient:leadSource.${ls}`, { defaultValue: ls })}
            </option>
          ))}
        </select>
      </FormField>

      {submitError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {submitError}
        </p>
      )}

      {duplicates && (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          <p className="font-medium">{t('patient:form.duplicates.title')}</p>
          <ul className="list-inside list-disc">
            {duplicates.map((d) => (
              <li key={d.id}>
                {t('patient:form.duplicates.reason', { id: d.id, reason: d.reason })}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" type="button" onClick={() => setDuplicates(null)}>
              {t('patient:form.duplicates.dismiss')}
            </Button>
            <Button size="sm" type="button" onClick={onForceCreate} disabled={create.isPending}>
              {t('patient:form.duplicates.force')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t('appointment:quickAdd.cancel')}
        </Button>
        <Button type="button" size="sm" onClick={() => void submit()} disabled={create.isPending}>
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {t('appointment:quickAdd.submit')}
        </Button>
      </div>
    </div>
  );
}
