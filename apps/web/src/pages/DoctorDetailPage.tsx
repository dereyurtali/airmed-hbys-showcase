import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TRPCClientError } from '@trpc/client';
import { Mail, Pencil, Phone, Trash2, UserCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AvailabilityEditor } from '../components/doctor/AvailabilityEditor';
import { DoctorLeavesSection } from '../components/doctor/DoctorLeavesSection';
import { DoctorPublicProfileCard } from '../components/doctor/DoctorPublicProfileCard';
import { DoctorVisitingWindowsSection } from '../components/doctor/DoctorVisitingWindowsSection';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { usePermission } from '../hooks/usePermission';
import { useConfirm } from '../hooks/useConfirm';
import { type AvailabilitySlot, DAYS_OF_WEEK } from '../lib/doctor.schemas';
import { trpc } from '../lib/trpc';

const DAY_LABEL_KEYS: Record<number, string> = {
  1: 'days.monday',
  2: 'days.tuesday',
  3: 'days.wednesday',
  4: 'days.thursday',
  5: 'days.friday',
  6: 'days.saturday',
  0: 'days.sunday',
};

export function DoctorDetailPage() {
  const { t } = useTranslation(['doctor', 'common']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  // S10a — Hardcode role check kaldırıldı (P1 #3.31). canEdit doctor.update perm.
  const canEdit = usePermission('action:doctor.update');
  // S8b — Sadece yönetici (user CRUD permission); asistan dahil değil.
  // #1149 — hesaplı doktorda kimlik/nitelik/durum hesap üzerinden yönetilir;
  // bu izin artık hesaba giden kısayolu kapılar (bayrak paneli Kullanıcı ekranında).
  const canManageAccount = usePermission('action:user.update');
  const { confirm } = useConfirm();

  const [saveError, setSaveError] = useState<string | null>(null);

  const detail = trpc.doctor.findById.useQuery({ id: id ?? '' }, { enabled: !!id });
  const setAvailability = trpc.doctor.setAvailability.useMutation({
    onSuccess: () => {
      void utils.doctor.findById.invalidate();
    },
    onError: (err) => {
      setSaveError(
        err instanceof TRPCClientError ? err.message : t('doctor:availability.saveError'),
      );
    },
  });
  const softDelete = trpc.doctor.softDelete.useMutation({
    onSuccess: async () => {
      await utils.doctor.list.invalidate();
      navigate('/doctors', { replace: true });
    },
  });

  const typeLabel = (type: string): string => {
    if (type === 'local' || type === 'visiting' || type === 'referral') {
      return t(`doctor:type.${type}`);
    }
    return type;
  };

  if (detail.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('doctor:detail.title')} />
        <p className="text-sm text-muted-foreground">{t('common:states.loading')}</p>
      </div>
    );
  }

  if (detail.error) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('doctor:detail.title')} />
        <div className="rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm text-critical-foreground">
          {detail.error.message}
        </div>
      </div>
    );
  }

  if (!detail.data) return null;
  const doctor = detail.data;
  // #1149 — hesaplı doktorda kimlik/iletişim tek kaynağı linkli hesap; profil-only
  // (login'siz sevk/dış) doktorda Doctor.contactPhone/Email kullanılır.
  const isLinkedAccount = Boolean(doctor.userId);
  const contactPhone = doctor.user?.phone ?? doctor.contactPhone;
  const contactEmail = doctor.user?.email ?? doctor.contactEmail;
  const availabilities: AvailabilitySlot[] = (doctor.availabilities ?? []).map((a) => ({
    dayOfWeek: a.dayOfWeek,
    startTime: a.startTime,
    endTime: a.endTime,
    isActive: a.isActive,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={doctor.name}
        description={`${doctor.specialty} · ${typeLabel(doctor.type)}`}
        actions={
          <div className="flex items-center gap-2">
            {/* #1149 — hesaplı doktorda kimlik/durum hesap üzerinden yönetilir:
                düzenle/pasifleştir gizli, hesaba kısayol. Profil-only (login'siz
                sevk/dış) doktorda tam düzenleme + pasifleştirme korunur. */}
            {isLinkedAccount
              ? canManageAccount && (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/admin/users/${doctor.userId}`}>
                      <UserCog className="mr-1 h-4 w-4" />
                      {t('doctor:detail.actions.manageAccount')}
                    </Link>
                  </Button>
                )
              : canEdit && (
                  <>
                    <Button asChild size="sm">
                      <Link to={`/doctors/${doctor.id}/edit`}>
                        <Pencil className="mr-1 h-4 w-4" />
                        {t('doctor:detail.actions.edit')}
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        if (
                          await confirm({
                            message: t('doctor:detail.actions.deactivateConfirm'),
                            destructive: true,
                          })
                        ) {
                          softDelete.mutate({ id: doctor.id });
                        }
                      }}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      {t('doctor:detail.actions.deactivate')}
                    </Button>
                  </>
                )}
          </div>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2">
        <InfoCard title={t('doctor:detail.sections.contact')}>
          <InfoRow
            icon={<Phone className="h-4 w-4" />}
            label={t('doctor:detail.fields.phone')}
            value={contactPhone}
          />
          <InfoRow
            icon={<Mail className="h-4 w-4" />}
            label={t('doctor:detail.fields.email')}
            value={contactEmail}
          />
          {isLinkedAccount && (
            <p className="pt-1 text-xs text-muted-foreground">
              {t('doctor:detail.identityManagedHint')}
            </p>
          )}
        </InfoCard>
        <InfoCard title={t('doctor:detail.sections.details')}>
          <InfoRow label={t('doctor:detail.fields.type')} value={typeLabel(doctor.type)} />
          <InfoRow
            label={t('doctor:detail.fields.commission')}
            value={
              doctor.commissionRate
                ? t('doctor:detail.fields.commissionValue', { value: doctor.commissionRate })
                : null
            }
          />
          <InfoRow
            label={t('doctor:detail.fields.status')}
            value={doctor.isActive ? t('doctor:status.active') : t('doctor:status.inactive')}
          />
        </InfoCard>
      </section>

      {doctor.notes && (
        <section className="rounded-lg border bg-muted/30 p-4">
          <h3 className="mb-2 text-sm font-medium">{t('doctor:detail.sections.notes')}</h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{doctor.notes}</p>
        </section>
      )}

      <section className="space-y-3">
        <header>
          <h2 className="text-lg font-semibold">{t('doctor:detail.sections.weeklyHours')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('doctor:detail.sections.weeklyHoursDescription')}
          </p>
        </header>
        {canEdit ? (
          <AvailabilityEditor
            initial={availabilities}
            onSave={async (slots) => {
              setSaveError(null);
              await setAvailability.mutateAsync({ id: doctor.id, data: { slots } });
            }}
            saving={setAvailability.isPending}
            saveError={saveError}
          />
        ) : (
          <ReadOnlyAvailability slots={availabilities} />
        )}
      </section>

      {/* #1050 — hasta-facing profil kartı (foto/unvan/bio/diller/publicProfile) */}
      <DoctorPublicProfileCard doctor={doctor} canEdit={canEdit} />

      <DoctorLeavesSection doctorId={doctor.id} canEdit={canEdit} />

      {/* #1048 — geliş pencereleri yalnız misafir doktorda anlamlı (misafir
          varsayılan randevuya kapalı; pencere açar). */}
      {doctor.type === 'visiting' && <DoctorVisitingWindowsSection doctorId={doctor.id} />}

      {/* #1149 — Nitelik/yetki bayrakları (Yerleşik/Misafir + tüm hastaları
          görsün) tek yerden yönetilir: Kullanıcı → Roller & Mod. Klinik ekranda
          çift düzenleme noktası bırakılmadı. */}
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h3>
      <dl className="space-y-2 text-sm">{children}</dl>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-1 text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="font-medium">{value ?? '—'}</dd>
    </div>
  );
}

function ReadOnlyAvailability({ slots }: { slots: AvailabilitySlot[] }) {
  const { t } = useTranslation('doctor');
  if (slots.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('availability.noneDefined')}</p>;
  }
  const byDay = new Map<number, AvailabilitySlot[]>();
  for (const s of slots) {
    const arr = byDay.get(s.dayOfWeek) ?? [];
    arr.push(s);
    byDay.set(s.dayOfWeek, arr);
  }
  return (
    <ul className="space-y-2 text-sm">
      {DAYS_OF_WEEK.filter((d) => byDay.has(d.value)).map((d) => (
        <li key={d.value} className="flex gap-3">
          <span className="w-32 text-muted-foreground">{t(DAY_LABEL_KEYS[d.value])}</span>
          <span>
            {byDay
              .get(d.value)!
              .map((s) => `${s.startTime} – ${s.endTime}`)
              .join(', ')}
          </span>
        </li>
      ))}
    </ul>
  );
}
