import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { FormField } from '../form/FormField';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { SPECIALTY_SUGGESTIONS } from '../../lib/doctor.schemas';
import { usePermission } from '../../hooks/usePermission';
import { trpc } from '../../lib/trpc';

// #1149 — Doktorun idari/klinik nitelikleri (uzmanlık, komisyon, not). Kimlik
// alanları (ad/telefon/e-posta) hesap tarafından yönetilir; bunlar doktor
// entity'sine özgü olduğundan personel kokpitinde (Kullanıcı → Roller & Mod)
// düzenlenir. Doktor klinik ekranı bunları yalnız readonly gösterir → çift
// düzenleme noktası ve ayrışma yok.
interface DoctorAdminFieldsEditorProps {
  doctorId: string;
}

export function DoctorAdminFieldsEditor({ doctorId }: DoctorAdminFieldsEditorProps) {
  const { t } = useTranslation('common');
  const canEdit = usePermission('action:doctor.update');
  const utils = trpc.useUtils();
  const detail = trpc.doctor.findById.useQuery({ id: doctorId });

  const schema = useMemo(
    () =>
      z.object({
        specialty: z
          .string()
          .trim()
          .min(1, t('usersPage.detail.doctorFields.specialtyRequired'))
          .max(100),
        // Serbest ondalık metin; boş = temizle. toApiPayload ile aynı kontrat.
        commissionRate: z
          .string()
          .regex(/^(\d+(\.\d{1,2})?)?$/, t('usersPage.detail.doctorFields.commissionInvalid'))
          .optional()
          .or(z.literal('')),
        notes: z.string().max(2000).optional().or(z.literal('')),
      }),
    [t],
  );

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { specialty: '', commissionRate: '', notes: '' },
  });

  useEffect(() => {
    if (!detail.data) return;
    form.reset({
      specialty: detail.data.specialty ?? '',
      commissionRate: detail.data.commissionRate != null ? String(detail.data.commissionRate) : '',
      notes: detail.data.notes ?? '',
    });
  }, [detail.data, form]);

  const update = trpc.doctor.update.useMutation({
    onSuccess: () => {
      toast.success(t('usersPage.detail.doctorFields.saved'));
      void utils.doctor.findById.invalidate({ id: doctorId });
    },
    onError: (err) => toast.error(err.message || t('usersPage.detail.doctorFields.saveError')),
  });

  const submit = form.handleSubmit(
    (values) =>
      update.mutate({
        id: doctorId,
        data: {
          specialty: values.specialty.trim(),
          commissionRate: values.commissionRate ? values.commissionRate : null,
          notes: values.notes && values.notes.trim().length > 0 ? values.notes.trim() : null,
        },
      }),
    () => toast.error(t('usersPage.validation.invalidPleaseCheck')),
  );

  return (
    <section className="space-y-3 rounded-lg border bg-background p-4">
      <div>
        <h3 className="text-sm font-medium">{t('usersPage.detail.doctorFields.title')}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('usersPage.detail.doctorFields.hint')}
        </p>
      </div>

      {detail.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('states.loading')}
        </div>
      ) : detail.error ? (
        <div className="rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm text-critical-foreground">
          {detail.error.message}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('usersPage.detail.doctorFields.specialty')}
              error={form.formState.errors.specialty?.message}
              required
            >
              <Input
                list="doctor-specialty-suggestions"
                disabled={!canEdit}
                {...form.register('specialty')}
              />
              <datalist id="doctor-specialty-suggestions">
                {SPECIALTY_SUGGESTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </FormField>
            <FormField
              label={t('usersPage.detail.doctorFields.commission')}
              description={t('usersPage.detail.doctorFields.commissionHint')}
              error={form.formState.errors.commissionRate?.message}
            >
              <Input
                type="number"
                min={0}
                max={100}
                step="0.01"
                inputMode="decimal"
                disabled={!canEdit}
                {...form.register('commissionRate')}
              />
            </FormField>
          </div>
          <FormField
            label={t('usersPage.detail.doctorFields.notes')}
            error={form.formState.errors.notes?.message}
          >
            <textarea
              rows={3}
              disabled={!canEdit}
              className="focus-ring flex min-h-[60px] w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover disabled:cursor-not-allowed disabled:opacity-50"
              {...form.register('notes')}
            />
          </FormField>
          {canEdit && (
            <div className="flex justify-end">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                {t('usersPage.detail.doctorFields.save')}
              </Button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
