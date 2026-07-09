import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePermission } from '../hooks/usePermission';
import { TRPCClientError } from '@trpc/client';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FormField } from '../components/form/FormField';
import { PhoneInput } from '../components/form/PhoneInput';
import { ChipsInput } from '../components/form/ChipsInput';
import { PageHeader } from '../components/layout/PageHeader';
import { PatientTagPicker } from '../components/patient/PatientTagPicker';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { DateField } from '../components/ui/date-field';
import {
  BLOOD_TYPES,
  emptyPatientForm,
  GUARDIAN_RELATIONSHIPS,
  LEAD_SOURCES,
  patientFormSchema,
  toApiPayload,
  type BloodType,
  type GuardianRelationship,
  type LeadSource,
  type PatientFormValues,
} from '../lib/patient.schemas';
import type { PatientTag } from '../lib/patient-tags.constants';
import { trpc } from '../lib/trpc';
import { useUnsavedWarning } from '../hooks/useUnsavedWarning';

/** S15-PR1 — Pediatrik yaş eşiği (UN Convention on the Rights of the Child). */
const PEDIATRIC_AGE_THRESHOLD = 18;

function calculateAge(birthDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const today = new Date();
  const bd = new Date(birthDate);
  if (Number.isNaN(bd.getTime())) return null;
  let age = today.getFullYear() - bd.getFullYear();
  const m = today.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age -= 1;
  return age;
}

interface DuplicateInfo {
  id: string;
  reason: string;
}

interface PatientFormPageProps {
  mode: 'create' | 'edit';
}

export function PatientFormPage({ mode }: PatientFormPageProps) {
  const { t } = useTranslation(['patient', 'common']);
  const navigate = useNavigate();
  // S8 — Birincil doktor dropdown için doktor listesi (sadece create mode'da).
  // Doktor diğer doktorları listeleyemez (zaten hasta oluşturamaz) → query kapalı.
  const canListDoctors = usePermission('action:doctor.list');
  const doctorsForPicker = trpc.doctor.list.useQuery(
    { page: 1, pageSize: 200, isActive: true },
    { staleTime: 5 * 60 * 1000, enabled: canListDoctors },
  );
  const params = useParams<{ id?: string }>();
  const patientId = params.id;
  const isEdit = mode === 'edit';

  const detail = trpc.patient.findById.useQuery(
    { id: patientId ?? '' },
    { enabled: isEdit && !!patientId, retry: false },
  );

  const utils = trpc.useUtils();

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateInfo[] | null>(null);
  const [pendingValues, setPendingValues] = useState<PatientFormValues | null>(null);

  const form = useForm<PatientFormValues>({
    resolver: zodResolver(patientFormSchema),
    defaultValues: emptyPatientForm,
  });

  useEffect(() => {
    if (isEdit && detail.data) {
      const d = detail.data as typeof detail.data & {
        allergies?: string[] | null;
        anticoagulantMedications?: string[] | null;
        bloodType?: BloodType | null;
        pediatricGuardianName?: string | null;
        pediatricGuardianPhone?: string | null;
        pediatricGuardianRelationship?: GuardianRelationship | null;
      };
      form.reset({
        firstName: d.firstName,
        lastName: d.lastName,
        birthDate: new Date(d.birthDate as unknown as string).toISOString().slice(0, 10),
        gender: d.gender,
        phone: d.phone ?? '',
        identityNo: d.identityNo ?? '',
        passportNo: d.passportNo ?? '',
        email: d.email ?? '',
        address: d.address ?? '',
        emergencyContactName: d.emergencyContactName ?? '',
        emergencyContactPhone: d.emergencyContactPhone ?? '',
        notes: d.notes ?? '',
        leadSource: ((d as { leadSource?: LeadSource | null }).leadSource ?? '') as LeadSource | '',
        leadSourceNote: (d as { leadSourceNote?: string | null }).leadSourceNote ?? '',
        tags: ((d as { tags?: PatientTag[] }).tags ?? []) as PatientTag[],
        primaryDoctorId: '',
        // S15-PR1 — Tıbbi alanlar
        allergies: d.allergies ?? [],
        anticoagulantMedications: d.anticoagulantMedications ?? [],
        bloodType: (d.bloodType ?? '') as BloodType | '',
        pediatricGuardianName: d.pediatricGuardianName ?? '',
        pediatricGuardianPhone: d.pediatricGuardianPhone ?? '',
        pediatricGuardianRelationship: (d.pediatricGuardianRelationship ?? '') as
          GuardianRelationship | '',
      });
    }
  }, [isEdit, detail.data, form]);

  // S15-PR1 — Yaş watcher: birthDate değişince pediatrik panel görünür/zorunluluk
  // değişir. Form values reactive olduğu için useMemo gerekmez.
  const watchedBirthDate = form.watch('birthDate');
  const age = calculateAge(watchedBirthDate);
  const isPediatric = age !== null && age < PEDIATRIC_AGE_THRESHOLD;

  // /patients/new saf kayıt ekranı: hasta oluşturulur, encounter AÇILMAZ
  // (bugünün kuyruğuna sokmaz). Walk-in dahil tüm akış randevu ekranındaki
  // hızlı-ekle + check-in (tip-bazlı yönlendirme) üzerinden ilerler.
  const createMutation = trpc.patient.create.useMutation({
    onSuccess: async () => {
      await utils.patient.list.invalidate();
      navigate('/patients', { replace: true });
    },
    onError: (err) => handleMutationError(err),
  });

  const updateMutation = trpc.patient.update.useMutation({
    onSuccess: async () => {
      await utils.patient.list.invalidate();
      if (patientId) await utils.patient.findById.invalidate({ id: patientId });
      navigate(`/patients/${patientId}`, { replace: true });
    },
    onError: (err) => handleMutationError(err),
  });

  function handleMutationError(err: unknown) {
    if (err instanceof TRPCClientError) {
      const data = err.data as
        { httpStatus?: number; cause?: { duplicates?: DuplicateInfo[] } } | undefined;
      const cause = (err.shape as { data?: { httpStatus?: number } } | undefined)?.data;
      if (cause?.httpStatus === 409 || data?.httpStatus === 409) {
        // tRPC envelopes the Nest ConflictException; payload contains duplicates list.
        const message = err.message;
        try {
          const parsed = JSON.parse(message) as { duplicates?: DuplicateInfo[] };
          if (parsed.duplicates) {
            setDuplicates(parsed.duplicates);
            return;
          }
        } catch {
          // message wasn't JSON — fall through to generic error
        }
      }
      setSubmitError(err.message);
    } else {
      setSubmitError(t('common:errors.unexpected'));
    }
  }

  const onSubmit = form.handleSubmit((values) => {
    setSubmitError(null);
    setDuplicates(null);
    const payload = toApiPayload(values);
    if (isEdit && patientId) {
      updateMutation.mutate({ id: patientId, data: payload });
    } else {
      setPendingValues(values);
      createMutation.mutate({ ...payload });
    }
  });

  const onForceCreate = () => {
    if (!pendingValues) return;
    setDuplicates(null);
    setSubmitError(null);
    const payload = toApiPayload(pendingValues);
    createMutation.mutate({ ...payload, force: true });
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // SİS-8 — Dolu formda yanlışlıkla sekme kapat/yenile veri kaybını uyarır.
  // Kayıt sürerken/sonrası (navigate) bayrak gerekmez.
  useUnsavedWarning(form.formState.isDirty && !isSubmitting);

  if (isEdit && detail.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (isEdit && detail.error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="max-w-sm space-y-3 text-center">
          <p className="text-sm text-destructive">
            {t('patient:form.loadFailed', { message: detail.error.message })}
          </p>
          <Button asChild variant="outline">
            <Link to="/patients">{t('common:actions.backToList')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? t('patient:form.editTitle') : t('patient:form.createTitle')}
        description={
          isEdit ? t('patient:form.editDescription') : t('patient:form.createDescription')
        }
        actions={
          <Button asChild variant="outline">
            <Link to="/patients">{t('common:actions.cancel')}</Link>
          </Button>
        }
      />

      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <section className="grid gap-4 sm:grid-cols-2">
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
              className="focus-ring flex h-10 w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
              {...form.register('gender')}
            >
              <option value="female">{t('patient:gender.female')}</option>
              <option value="male">{t('patient:gender.male')}</option>
              <option value="other">{t('patient:gender.other')}</option>
            </select>
          </FormField>
          <FormField
            label={t('patient:form.fields.phone')}
            required
            error={form.formState.errors.phone?.message}
          >
            <PhoneInput
              value={form.watch('phone') ?? ''}
              onChange={(v) =>
                form.setValue('phone', v, { shouldDirty: true, shouldValidate: true })
              }
              ariaInvalid={!!form.formState.errors.phone}
            />
          </FormField>
          <FormField
            label={t('patient:form.fields.email')}
            error={form.formState.errors.email?.message}
          >
            <Input type="email" {...form.register('email')} autoComplete="email" />
          </FormField>
          <FormField
            label={t('patient:form.fields.identityNo')}
            error={form.formState.errors.identityNo?.message}
          >
            <Input {...form.register('identityNo')} />
          </FormField>
          <FormField
            label={t('patient:form.fields.passportNo')}
            error={form.formState.errors.passportNo?.message}
          >
            <Input {...form.register('passportNo')} />
          </FormField>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t('patient:form.sections.emergency')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('patient:form.fields.emergencyName')}
              error={form.formState.errors.emergencyContactName?.message}
            >
              <Input {...form.register('emergencyContactName')} />
            </FormField>
            <FormField
              label={t('patient:form.fields.emergencyPhone')}
              error={form.formState.errors.emergencyContactPhone?.message}
            >
              <PhoneInput
                value={form.watch('emergencyContactPhone') ?? ''}
                onChange={(v) =>
                  form.setValue('emergencyContactPhone', v, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                ariaInvalid={!!form.formState.errors.emergencyContactPhone}
              />
            </FormField>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t('patient:form.sections.tags')}</h2>
          <p className="text-xs text-muted-foreground">{t('patient:tags.hint')}</p>
          <PatientTagPicker
            value={form.watch('tags') ?? []}
            onChange={(next) => form.setValue('tags', next, { shouldDirty: true })}
          />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t('patient:form.sections.leadSource')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('patient:form.fields.leadSource')}
              error={form.formState.errors.leadSource?.message}
            >
              <select
                className="focus-ring flex h-10 w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
                {...form.register('leadSource')}
              >
                <option value="">{t('patient:leadSource.unset')}</option>
                {LEAD_SOURCES.map((src) => (
                  <option key={src} value={src}>
                    {t(`patient:leadSource.${src}`)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              label={t('patient:form.fields.leadSourceNote')}
              error={form.formState.errors.leadSourceNote?.message}
            >
              <Input
                {...form.register('leadSourceNote')}
                placeholder={t('patient:form.leadSourceNotePlaceholder')}
              />
            </FormField>
          </div>
        </section>

        {/* S8 — Birincil doktor manuel atama (karar tutanağı §7). Sadece
            yeni hasta yaratırken; edit'te mevcut atama gösterimi henüz yok
            (P1 polish'inde DoctorAssignmentSection eklenir). */}
        {mode === 'create' && (
          <section className="space-y-4">
            <h2 className="text-lg font-medium">
              {t('patient:form.sections.primaryDoctor', { defaultValue: 'Birincil Doktor' })}
            </h2>
            <FormField
              label={t('patient:form.fields.primaryDoctor', {
                defaultValue: 'Birincil Doktor (opsiyonel)',
              })}
              description={t('patient:form.primaryDoctorHint', {
                defaultValue:
                  'Bu hastanın sorumlu hekimi. İlk randevu açıldığında otomatik de atanır; manuel seçim öncelikli kayıt yapar.',
              })}
              error={form.formState.errors.primaryDoctorId?.message}
            >
              <select
                className="focus-ring flex h-10 w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
                {...form.register('primaryDoctorId')}
                disabled={doctorsForPicker.isLoading}
              >
                <option value="">
                  {t('patient:form.primaryDoctorNone', { defaultValue: '— Seçilmedi —' })}
                </option>
                {(doctorsForPicker.data?.items ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.specialty ? ` · ${d.specialty}` : ''}
                  </option>
                ))}
              </select>
            </FormField>
          </section>
        )}

        {/* S15-PR1 — Tıbbi alanlar. Allerji/antikoagülan: cerrahi öncesi
            kritik. Pre-op safety checklist (PR3) ve drug interaction (PR4)
            burada girilen veriyi okur. */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t('patient:form.sections.medical')}</h2>
          <p className="text-xs text-muted-foreground">{t('patient:form.medicalHint')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('patient:form.fields.allergies')}
              error={
                Array.isArray(form.formState.errors.allergies)
                  ? form.formState.errors.allergies.find((e) => e?.message)?.message
                  : form.formState.errors.allergies?.message
              }
              description={t('patient:form.allergiesHint')}
            >
              <ChipsInput
                value={form.watch('allergies') ?? []}
                onChange={(next) =>
                  form.setValue('allergies', next, { shouldDirty: true, shouldValidate: true })
                }
                placeholder={t('patient:form.allergiesPlaceholder')}
                ariaLabel={t('patient:form.fields.allergies')}
              />
            </FormField>
            <FormField
              label={t('patient:form.fields.anticoagulants')}
              error={
                Array.isArray(form.formState.errors.anticoagulantMedications)
                  ? form.formState.errors.anticoagulantMedications.find((e) => e?.message)?.message
                  : form.formState.errors.anticoagulantMedications?.message
              }
              description={t('patient:form.anticoagulantsHint')}
            >
              <ChipsInput
                value={form.watch('anticoagulantMedications') ?? []}
                onChange={(next) =>
                  form.setValue('anticoagulantMedications', next, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                placeholder={t('patient:form.anticoagulantsPlaceholder')}
                ariaLabel={t('patient:form.fields.anticoagulants')}
              />
            </FormField>
            <FormField
              label={t('patient:form.fields.bloodType')}
              error={form.formState.errors.bloodType?.message}
            >
              <select
                className="focus-ring flex h-10 w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
                {...form.register('bloodType')}
              >
                <option value="">{t('patient:bloodType.unset')}</option>
                {BLOOD_TYPES.map((bt) => (
                  <option key={bt} value={bt}>
                    {t(`patient:bloodType.${bt}`)}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </section>

        {/* S15-PR1 — Pediatrik veli. Yaş <18 ise vurgulu görünür ve dolduruluk
            kuvvetle önerilir. PR7'de service-layer zorunluluk gelir; şu an UI
            uyarı banner ile kullanıcıyı yönlendiriyoruz. */}
        {(isPediatric || form.watch('pediatricGuardianName')) && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-medium">{t('patient:form.sections.pediatric')}</h2>
              {isPediatric && (
                <Badge variant="warning">{t('patient:form.pediatricBadge', { age })}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('patient:form.pediatricHint')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label={t('patient:form.fields.guardianName')}
                error={form.formState.errors.pediatricGuardianName?.message}
              >
                <Input {...form.register('pediatricGuardianName')} autoComplete="name" />
              </FormField>
              <FormField
                label={t('patient:form.fields.guardianPhone')}
                error={form.formState.errors.pediatricGuardianPhone?.message}
              >
                <PhoneInput
                  value={form.watch('pediatricGuardianPhone') ?? ''}
                  onChange={(v) =>
                    form.setValue('pediatricGuardianPhone', v, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  ariaInvalid={!!form.formState.errors.pediatricGuardianPhone}
                />
              </FormField>
              <FormField
                label={t('patient:form.fields.guardianRelationship')}
                error={form.formState.errors.pediatricGuardianRelationship?.message}
              >
                <select
                  className="focus-ring flex h-10 w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
                  {...form.register('pediatricGuardianRelationship')}
                >
                  <option value="">{t('patient:guardianRelationship.unset')}</option>
                  {GUARDIAN_RELATIONSHIPS.map((gr) => (
                    <option key={gr} value={gr}>
                      {t(`patient:guardianRelationship.${gr}`)}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          </section>
        )}

        <section className="space-y-4">
          <FormField
            label={t('patient:form.fields.address')}
            error={form.formState.errors.address?.message}
          >
            <textarea
              rows={2}
              className="focus-ring flex w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
              {...form.register('address')}
            />
          </FormField>
          <FormField
            label={t('patient:form.fields.notes')}
            error={form.formState.errors.notes?.message}
          >
            <textarea
              rows={3}
              className="focus-ring flex w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
              {...form.register('notes')}
            />
          </FormField>
        </section>

        {submitError && (
          <div
            role="alert"
            className="rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm text-critical-foreground"
          >
            {submitError}
          </div>
        )}

        {duplicates && (
          <div className="space-y-3 rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning-foreground">
            <p className="font-medium">{t('patient:form.duplicates.title')}</p>
            <ul className="list-disc list-inside text-xs">
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
              <Button size="sm" type="button" onClick={onForceCreate}>
                {t('patient:form.duplicates.force')}
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button asChild variant="outline" type="button">
            <Link to="/patients">{t('common:actions.cancel')}</Link>
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? t('patient:form.submitUpdate') : t('patient:form.submitCreate')}
          </Button>
        </div>
      </form>
    </div>
  );
}
