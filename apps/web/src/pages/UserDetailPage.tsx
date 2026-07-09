import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CalendarDays, KeyRound, Loader2, UserRound } from 'lucide-react';
import { z } from 'zod';
import { DoctorAdminFieldsEditor } from '../components/doctor/DoctorAdminFieldsEditor';
import { DoctorFlagsToggle } from '../components/doctor/DoctorFlagsToggle';
import { FormField } from '../components/form/FormField';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { StaffDocumentsSection } from '../components/users/StaffDocumentsSection';
import {
  PasswordRevealDialog,
  USER_LOCALES,
  UserConfirmDialog,
  UserStatusBadge,
  extractErr,
  type UserConfirmKind,
  type UserStatus,
  type UserSummary,
} from '../components/users/UserAdminDialogs';
import { usePermission } from '../hooks/usePermission';
import { formatDateTime } from '../lib/i18n-format';
import { trpc } from '../lib/trpc';
import { useAuth } from '../providers/AuthProvider';
import { useLocale } from '../providers/LocaleProvider';
import { cn } from '../lib/utils';

// #1050 — Kullanıcı detay sayfası (yönetici): 3 sekme (Profil / Roller & Mod /
// Dökümanlar). AdminUsersPage satırından gelinir; sol menüde yok → BackBar
// AppShell'den otomatik gelir (sayfaya kendi geri butonu KOYMA — 2026-07-04 kuralı).

const SELECT_CLASS =
  'focus-ring flex h-10 w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover disabled:cursor-not-allowed disabled:opacity-50';

const NURSE_MODES = ['genel', 'asistan', 'olcum'] as const;
type NurseMode = (typeof NURSE_MODES)[number];

type TabKey = 'profile' | 'roles' | 'documents';

type UserFlags = { modes?: string[]; is_visiting_doctor?: boolean } & Record<string, unknown>;

export function UserDetailPage() {
  const { t } = useTranslation('common');
  const { id } = useParams<{ id: string }>();
  const { user: me } = useAuth();
  const utils = trpc.useUtils();
  const canViewDocs = usePermission('view:staffDocument');

  const [tab, setTab] = useState<TabKey>('profile');
  const [passwordModal, setPasswordModal] = useState<{ email: string; password: string } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<{ kind: UserConfirmKind; user: UserSummary } | null>(null);

  const detail = trpc.userAdmin.get.useQuery({ id: id ?? '' }, { enabled: !!id });

  const invalidate = () => {
    void utils.userAdmin.get.invalidate({ id: id ?? '' });
    void utils.userAdmin.list.invalidate();
  };

  const resetMut = trpc.userAdmin.resetPassword.useMutation({
    onSuccess: ({ password }) => {
      const email = confirm?.user.email ?? '';
      setConfirm(null);
      setPasswordModal({ email, password });
      toast.success(t('usersPage.toast.passwordReset'));
    },
    onError: (err) => toast.error(extractErr(err, t('usersPage.confirm.resetPassword.error'))),
  });
  const deactivateMut = trpc.userAdmin.deactivate.useMutation({
    onSuccess: () => {
      toast.success(t('usersPage.toast.deactivated'));
      setConfirm(null);
      invalidate();
    },
    onError: (err) => toast.error(extractErr(err, t('usersPage.confirm.deactivate.error'))),
  });
  const reactivateMut = trpc.userAdmin.reactivate.useMutation({
    onSuccess: () => {
      toast.success(t('usersPage.toast.reactivated'));
      setConfirm(null);
      invalidate();
    },
    onError: (err) => toast.error(extractErr(err, t('usersPage.confirm.reactivate.error'))),
  });

  if (detail.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('usersPage.detail.title')} />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('states.loading')}
        </div>
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('usersPage.detail.title')} />
        <div className="rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm text-critical-foreground">
          {detail.error?.message ?? t('usersPage.detail.notFound')}
        </div>
      </div>
    );
  }

  const user = detail.data;
  const status = user.status as UserStatus;
  const flags = (user.flags ?? {}) as UserFlags;
  const roleKeys = user.userRoles.map((ur) => ur.role.key);
  const isNurse = roleKeys.includes('hemsire');
  const isSelf = user.id === (me?.id ?? '');

  const tabs: { key: TabKey; label: string; visible: boolean }[] = [
    { key: 'profile', label: t('usersPage.detail.tabs.profile'), visible: true },
    { key: 'roles', label: t('usersPage.detail.tabs.roles'), visible: true },
    { key: 'documents', label: t('usersPage.detail.tabs.documents'), visible: canViewDocs },
  ];
  const visibleTabs = tabs.filter((x) => x.visible);
  const activeTab = visibleTabs.some((x) => x.key === tab) ? tab : 'profile';

  return (
    <div className="space-y-6">
      <PageHeader
        title={user.name}
        description={user.email}
        actions={<UserStatusBadge status={status} />}
      />

      <div className="flex flex-wrap gap-2" role="tablist">
        {visibleTabs.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={activeTab === x.key}
            data-testid={`user-detail-tab-${x.key}`}
            onClick={() => setTab(x.key)}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
              activeTab === x.key
                ? 'border-primary bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {x.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <ProfileTab
          user={user}
          isSelf={isSelf}
          onSaved={invalidate}
          onResetPassword={() =>
            setConfirm({
              kind: 'resetPassword',
              user: { id: user.id, email: user.email, name: user.name },
            })
          }
          onDeactivate={() =>
            setConfirm({
              kind: 'deactivate',
              user: { id: user.id, email: user.email, name: user.name },
            })
          }
          onReactivate={() =>
            setConfirm({
              kind: 'reactivate',
              user: { id: user.id, email: user.email, name: user.name },
            })
          }
        />
      )}

      {activeTab === 'roles' && (
        <RolesTab
          userId={user.id}
          roleKeys={roleKeys}
          isNurse={isNurse}
          flags={flags}
          doctorProfile={user.doctorProfile}
          onSaved={invalidate}
        />
      )}

      {activeTab === 'documents' && canViewDocs && <StaffDocumentsSection userId={user.id} />}

      <PasswordRevealDialog data={passwordModal} onClose={() => setPasswordModal(null)} />
      <UserConfirmDialog
        state={confirm}
        onClose={() => setConfirm(null)}
        onResetPassword={(uid) => resetMut.mutateAsync({ id: uid })}
        onDeactivate={(uid) => deactivateMut.mutateAsync({ id: uid })}
        onReactivate={(uid) => reactivateMut.mutateAsync({ id: uid })}
        loading={resetMut.isPending || deactivateMut.isPending || reactivateMut.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profil sekmesi — ad/telefon/dil düzenleme + hesap aksiyonları
// ---------------------------------------------------------------------------

interface ProfileUser {
  id: string;
  email: string;
  name: string;
  locale: string;
  phone: string | null;
  status: string;
  lastLoginAt: string | Date | null;
}

function ProfileTab({
  user,
  isSelf,
  onSaved,
  onResetPassword,
  onDeactivate,
  onReactivate,
}: {
  user: ProfileUser;
  isSelf: boolean;
  onSaved: () => void;
  onResetPassword: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}) {
  const { t } = useTranslation('common');
  const { locale: uiLocale } = useLocale();

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(2).max(100),
        locale: z.enum(USER_LOCALES),
        // Backend kuralıyla aynı: ≥1 rakam + izinli karakterler; boş = temizle.
        phone: z
          .string()
          .trim()
          .max(30)
          .refine((v) => v === '' || (v.length >= 4 && /^(?=[^0-9]*\d)[+0-9 ()-]+$/.test(v)), {
            message: t('usersPage.detail.profile.phoneInvalid'),
          }),
      }),
    [t],
  );

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: user.name,
      locale: user.locale as (typeof USER_LOCALES)[number],
      phone: user.phone ?? '',
    },
  });

  useEffect(() => {
    form.reset({
      name: user.name,
      locale: user.locale as (typeof USER_LOCALES)[number],
      phone: user.phone ?? '',
    });
  }, [user, form]);

  const updateMut = trpc.userAdmin.update.useMutation({
    onSuccess: () => {
      toast.success(t('usersPage.detail.profile.saved'));
      onSaved();
    },
    onError: (err) => toast.error(extractErr(err, t('usersPage.detail.profile.saveError'))),
  });

  const submit = form.handleSubmit(
    (values) =>
      updateMut.mutate({
        id: user.id,
        name: values.name,
        locale: values.locale,
        phone: values.phone.trim() === '' ? null : values.phone.trim(),
      }),
    () => toast.error(t('usersPage.validation.invalidPleaseCheck')),
  );

  const isActive = user.status === 'active';

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <form onSubmit={submit} className="space-y-4 rounded-lg border bg-background p-4">
        <FormField label={t('usersPage.create.fields.email')}>
          <Input value={user.email} readOnly disabled />
        </FormField>
        <FormField
          label={t('usersPage.create.fields.name')}
          error={form.formState.errors.name?.message}
          required
        >
          <Input {...form.register('name')} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('usersPage.detail.profile.phone')}
            error={form.formState.errors.phone?.message}
          >
            <Input
              type="tel"
              inputMode="tel"
              placeholder={t('usersPage.detail.profile.phonePlaceholder')}
              {...form.register('phone')}
            />
          </FormField>
          <FormField label={t('usersPage.create.fields.locale')} required>
            <select className={SELECT_CLASS} {...form.register('locale')}>
              {USER_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {t(`usersPage.locales.${l}`)}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('usersPage.detail.profile.lastLogin')}:{' '}
          {user.lastLoginAt
            ? formatDateTime(user.lastLoginAt, uiLocale)
            : t('usersPage.lastLoginNever')}
        </p>
        <div className="flex justify-end">
          <Button type="submit" disabled={updateMut.isPending}>
            {updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {t('usersPage.detail.profile.save')}
          </Button>
        </div>
      </form>

      <div className="space-y-3 rounded-lg border bg-background p-4">
        <h3 className="text-sm font-medium">{t('usersPage.detail.actionsCard.title')}</h3>
        <Button type="button" variant="outline" className="w-full" onClick={onResetPassword}>
          <KeyRound className="mr-2 h-4 w-4" aria-hidden />
          {t('usersPage.rowActions.resetPassword')}
        </Button>
        {isActive ? (
          <>
            {/* airmed-design: durum uygun değilse disabled+sebep — kendi hesabı pasifleştirilemez */}
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              disabled={isSelf}
              onClick={onDeactivate}
            >
              {t('usersPage.rowActions.deactivate')}
            </Button>
            {isSelf && (
              <p className="text-xs text-muted-foreground">
                {t('usersPage.detail.actionsCard.selfDeactivateHint')}
              </p>
            )}
          </>
        ) : (
          <Button type="button" variant="outline" className="w-full" onClick={onReactivate}>
            {t('usersPage.rowActions.reactivate')}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roller & Mod sekmesi — rol rozetleri (salt-görüntüleme) + hemşire mod
// adayları + doktora bağlıysa nitelik toggle'ı
// ---------------------------------------------------------------------------

function RolesTab({
  userId,
  roleKeys,
  isNurse,
  flags,
  doctorProfile,
  onSaved,
}: {
  userId: string;
  roleKeys: string[];
  isNurse: boolean;
  flags: UserFlags;
  doctorProfile: { id: string; specialty: string; type: string } | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation('common');

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-background p-4">
        <h3 className="text-sm font-medium">{t('usersPage.detail.roles.title')}</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {roleKeys.length === 0 ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : (
            roleKeys.map((k) => (
              <Badge key={k} variant="secondary">
                <UserRound className="mr-1 h-3 w-3" aria-hidden />
                {t(`usersPage.roleLabels.${k}`)}
              </Badge>
            ))
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t('usersPage.detail.roles.readonlyHint')}
        </p>
      </section>

      {isNurse && <NurseModesEditor userId={userId} flags={flags} onSaved={onSaved} />}

      {doctorProfile && (
        <div className="space-y-4">
          {/* #1149 — doktor personel kokpiti: idari alanlar + nitelik burada
              (kimlik hesap tarafında). Klinik takvim/izin ayrı ekran → kısayol. */}
          <section className="rounded-lg border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">{t('usersPage.detail.roles.doctorTitle')}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('usersPage.detail.roles.doctorHint')}
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to={`/doctors/${doctorProfile.id}`}>
                  <CalendarDays className="mr-2 h-4 w-4" aria-hidden />
                  {t('usersPage.detail.roles.openDoctorClinical')}
                </Link>
              </Button>
            </div>
          </section>

          <DoctorAdminFieldsEditor doctorId={doctorProfile.id} />

          <DoctorFlagsToggle doctorId={doctorProfile.id} />
        </div>
      )}
    </div>
  );
}

function NurseModesEditor({
  userId,
  flags,
  onSaved,
}: {
  userId: string;
  flags: UserFlags;
  onSaved: () => void;
}) {
  const { t } = useTranslation('common');
  const initial = useMemo(
    () => NURSE_MODES.filter((m) => Array.isArray(flags.modes) && flags.modes.includes(m)),
    [flags.modes],
  );
  const [selected, setSelected] = useState<NurseMode[]>(initial);

  useEffect(() => setSelected(initial), [initial]);

  const updateModes = trpc.userAdmin.updateModes.useMutation({
    onSuccess: () => {
      toast.success(t('usersPage.detail.roles.modesSaved'));
      onSaved();
    },
    onError: (err) => toast.error(extractErr(err, t('errors.unexpected'))),
  });

  const toggle = (mode: NurseMode) =>
    setSelected((prev) => (prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]));

  const none = selected.length === 0;

  return (
    <section className="space-y-3 rounded-lg border bg-background p-4">
      <div>
        <h3 className="text-sm font-medium">{t('usersPage.detail.roles.modesTitle')}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('usersPage.detail.roles.modesHint')}
        </p>
      </div>
      <div className="space-y-2">
        {NURSE_MODES.map((mode) => (
          <label key={mode} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(mode)}
              onChange={() => toggle(mode)}
              data-testid={`nurse-mode-${mode}`}
            />
            {t(`usersPage.detail.roles.modeLabels.${mode}`)}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        {/* airmed-design: durum uygun değilse disabled+sebep — en az 1 mod şart */}
        <Button
          type="button"
          size="sm"
          disabled={none || updateModes.isPending}
          onClick={() => updateModes.mutate({ id: userId, modes: selected })}
        >
          {updateModes.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {t('usersPage.detail.roles.modesSave')}
        </Button>
        {none && (
          <span className="text-xs text-critical-foreground">
            {t('usersPage.detail.roles.modesMinWarning')}
          </span>
        )}
      </div>
    </section>
  );
}
