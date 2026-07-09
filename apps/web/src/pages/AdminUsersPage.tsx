import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { useLocale } from '../providers/LocaleProvider';
import { formatDateTime } from '../lib/i18n-format';
import { toast } from 'sonner';
import { Loader2, MoreHorizontal, Search, UserPlus } from 'lucide-react';
import { z } from 'zod';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { FormField } from '../components/form/FormField';
import { PageHeader } from '../components/layout/PageHeader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  PasswordRevealDialog,
  USER_LOCALES,
  USER_STATUSES,
  UserConfirmDialog,
  UserStatusBadge,
  extractErr,
  type UserConfirmKind,
  type UserStatus,
} from '../components/users/UserAdminDialogs';
import { trpc } from '../lib/trpc';
import { useAuth } from '../providers/AuthProvider';
import { cn } from '../lib/utils';

const ROLE_KEYS = [
  'yonetici',
  'yonetici_asistani',
  'doktor',
  'resepsiyon',
  'hemsire',
  'ameliyat_satis',
  'olcum_hemsiresi',
  // v0.4 #565 — 3 yeni rol (kanonik: DEFAULT_CLINIC_ROLES). Yeni rol eklenince
  // bu liste de güncellenmeli; drift = rol UI'dan atanamaz / matriste çıkmaz.
  'finans',
  'stok_satinalma',
  'eczane',
] as const;
type RoleKey = (typeof ROLE_KEYS)[number];

type Locale = (typeof USER_LOCALES)[number];

type ListItem = {
  id: string;
  email: string;
  name: string;
  locale: Locale;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt: string | Date | null;
  createdAt: string | Date;
  userRoles: Array<{ role: { key: RoleKey; label: string } }>;
  doctorProfile: { id: string; specialty: string; type: string } | null;
};

const SELECT_CLASS =
  'focus-ring flex h-10 w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover disabled:cursor-not-allowed disabled:opacity-50';

/** Yönetici personel yönetim ekranı — liste + filtre; satır tıklaması detay sayfasına gider (#1050). */
export function AdminUsersPage() {
  const { t } = useTranslation('common');
  const { locale } = useLocale();
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const myId = me?.id ?? '';

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleKey | ''>('');
  const [statusFilter, setStatusFilter] = useState<UserStatus | ''>('');

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(handle);
  }, [search]);

  const utils = trpc.useUtils();
  const listQuery = trpc.userAdmin.list.useQuery({
    page: 1,
    pageSize: 100,
    search: debounced || undefined,
    roleKey: roleFilter || undefined,
    status: statusFilter || undefined,
  });

  const [openCreate, setOpenCreate] = useState(false);
  const [passwordModal, setPasswordModal] = useState<{ email: string; password: string } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<{
    kind: UserConfirmKind;
    user: ListItem;
  } | null>(null);

  const invalidateList = () => utils.userAdmin.list.invalidate();

  const createMut = trpc.userAdmin.create.useMutation({
    onSuccess: ({ password, user }) => {
      toast.success(t('usersPage.toast.created'));
      setOpenCreate(false);
      setPasswordModal({ email: user.email, password });
      void invalidateList();
    },
    onError: (err) => toast.error(extractErr(err, t('usersPage.create.errors.generic'))),
  });

  const resetMut = trpc.userAdmin.resetPassword.useMutation({
    onSuccess: ({ password }) => {
      const email = confirm?.kind === 'resetPassword' ? confirm.user.email : '';
      setConfirm(null);
      setPasswordModal({ email, password });
      toast.success(t('usersPage.toast.passwordReset'));
      void invalidateList();
    },
    onError: (err) => toast.error(extractErr(err, t('usersPage.confirm.resetPassword.error'))),
  });

  const deactivateMut = trpc.userAdmin.deactivate.useMutation({
    onSuccess: () => {
      toast.success(t('usersPage.toast.deactivated'));
      setConfirm(null);
      void invalidateList();
    },
    onError: (err) => toast.error(extractErr(err, t('usersPage.confirm.deactivate.error'))),
  });

  const reactivateMut = trpc.userAdmin.reactivate.useMutation({
    onSuccess: () => {
      toast.success(t('usersPage.toast.reactivated'));
      setConfirm(null);
      void invalidateList();
    },
    onError: (err) => toast.error(extractErr(err, t('usersPage.confirm.reactivate.error'))),
  });

  const items: ListItem[] = (listQuery.data?.items as ListItem[] | undefined) ?? [];
  const total = listQuery.data?.total ?? 0;

  const filtersActive = Boolean(debounced || roleFilter || statusFilter);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('usersPage.title')}
        description={t('usersPage.description')}
        actions={
          <Button onClick={() => setOpenCreate(true)}>
            <UserPlus className="mr-2 h-4 w-4" aria-hidden />
            {t('usersPage.actions.add')}
          </Button>
        }
      />

      <section className="rounded-lg border bg-background">
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <div className="relative min-w-[240px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('usersPage.search.placeholder')}
              className="pl-9"
              aria-label={t('usersPage.search.placeholder')}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('usersPage.filters.role')}</span>
            <select
              className={cn(SELECT_CLASS, 'h-9 w-40')}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as RoleKey | '')}
            >
              <option value="">{t('usersPage.filters.roleAll')}</option>
              {ROLE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`usersPage.roleLabels.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('usersPage.filters.status')}</span>
            <select
              className={cn(SELECT_CLASS, 'h-9 w-36')}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as UserStatus | '')}
            >
              <option value="">{t('usersPage.filters.statusAll')}</option>
              {USER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`usersPage.status.${s}`)}
                </option>
              ))}
            </select>
          </label>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setRoleFilter('');
                setStatusFilter('');
              }}
            >
              {t('usersPage.filters.clear')}
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {t('usersPage.count', { count: total })}
          </span>
        </div>

        {listQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t('usersPage.loading')}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title={t('usersPage.empty.title')}
            description={t('usersPage.empty.description')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usersPage.columns.name')}</TableHead>
                <TableHead>{t('usersPage.columns.email')}</TableHead>
                <TableHead>{t('usersPage.columns.role')}</TableHead>
                <TableHead>{t('usersPage.columns.status')}</TableHead>
                <TableHead>{t('usersPage.columns.lastLogin')}</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">{t('usersPage.columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const roleKey = item.userRoles[0]?.role.key;
                const isSelf = item.id === myId;
                return (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    data-testid={`user-row-${item.id}`}
                    onClick={() => navigate(`/admin/users/${item.id}`)}
                  >
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground">{item.email}</TableCell>
                    <TableCell>
                      {roleKey ? (
                        <Badge variant="secondary">{t(`usersPage.roleLabels.${roleKey}`)}</Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <UserStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.lastLoginAt
                        ? formatDateTime(item.lastLoginAt, locale)
                        : t('usersPage.lastLoginNever')}
                    </TableCell>
                    {/* Aksiyon hücresi satır navigasyonunu tetiklememeli */}
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('usersPage.rowActions.open')}
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => navigate(`/admin/users/${item.id}`)}>
                            {t('usersPage.rowActions.view')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setConfirm({ kind: 'resetPassword', user: item })}
                          >
                            {t('usersPage.rowActions.resetPassword')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {item.status === 'active' ? (
                            <DropdownMenuItem
                              disabled={isSelf}
                              onSelect={() =>
                                !isSelf && setConfirm({ kind: 'deactivate', user: item })
                              }
                              className="text-destructive focus:text-destructive"
                            >
                              {t('usersPage.rowActions.deactivate')}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => setConfirm({ kind: 'reactivate', user: item })}
                            >
                              {t('usersPage.rowActions.reactivate')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <CreateUserDialog
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onSubmit={(input) => createMut.mutateAsync(input)}
        submitting={createMut.isPending}
      />

      <PasswordRevealDialog data={passwordModal} onClose={() => setPasswordModal(null)} />

      <UserConfirmDialog
        state={confirm}
        onClose={() => setConfirm(null)}
        onResetPassword={(id) => resetMut.mutateAsync({ id })}
        onDeactivate={(id) => deactivateMut.mutateAsync({ id })}
        onReactivate={(id) => reactivateMut.mutateAsync({ id })}
        loading={resetMut.isPending || deactivateMut.isPending || reactivateMut.isPending}
      />
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <UserPlus className="h-5 w-5 text-muted-foreground" aria-hidden />
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

type CreateInput = {
  email: string;
  name: string;
  roleKey: RoleKey;
  locale: Locale;
  doctor?: { specialty: string; type: 'local' | 'visiting' };
};

function buildCreateSchema(t: (key: string) => string) {
  return z
    .object({
      email: z
        .string()
        .trim()
        .email(t('forms.invalidEmail') || 'invalid')
        .max(255),
      name: z.string().trim().min(2).max(100),
      roleKey: z.enum(ROLE_KEYS),
      locale: z.enum(USER_LOCALES),
      doctor: z
        .object({
          specialty: z.string().trim().max(100),
          type: z.enum(['local', 'visiting']),
        })
        .optional(),
    })
    .superRefine((v, ctx) => {
      if (v.roleKey !== 'doktor') return;
      if (!v.doctor || v.doctor.specialty.trim().length < 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['doctor', 'specialty'],
          message: t('usersPage.create.fields.specialty'),
        });
      }
    });
}

function CreateUserDialog({
  open,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateInput) => Promise<unknown>;
  submitting: boolean;
}) {
  const { t } = useTranslation('common');
  const schema = useMemo(() => buildCreateSchema(t), [t]);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: '',
      name: '',
      roleKey: 'doktor',
      locale: 'tr',
      doctor: { specialty: '', type: 'local' },
    },
  });
  const roleKey = form.watch('roleKey');

  useEffect(() => {
    if (open) form.reset();
  }, [open, form]);

  const submit = form.handleSubmit(
    async (values) => {
      const payload: CreateInput =
        values.roleKey === 'doktor'
          ? {
              email: values.email,
              name: values.name,
              roleKey: 'doktor',
              locale: values.locale,
              doctor: values.doctor!,
            }
          : {
              email: values.email,
              name: values.name,
              roleKey: values.roleKey,
              locale: values.locale,
            };
      try {
        await onSubmit(payload);
      } catch (err) {
        const msg = extractErr(
          err,
          err instanceof TRPCClientError && err.message.toLowerCase().includes('zaten')
            ? t('usersPage.create.errors.duplicate')
            : t('usersPage.create.errors.generic'),
        );
        toast.error(msg);
      }
    },
    () => toast.error(t('usersPage.validation.invalidPleaseCheck')),
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-full max-w-lg p-6">
        <div className="space-y-1.5 mb-4">
          <DialogTitle>{t('usersPage.create.title')}</DialogTitle>
          <DialogDescription>{t('usersPage.create.description')}</DialogDescription>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <FormField
            label={t('usersPage.create.fields.name')}
            error={form.formState.errors.name?.message}
            required
          >
            <Input autoFocus {...form.register('name')} />
          </FormField>
          <FormField
            label={t('usersPage.create.fields.email')}
            error={form.formState.errors.email?.message}
            required
          >
            <Input type="email" inputMode="email" autoComplete="off" {...form.register('email')} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label={t('usersPage.create.fields.role')} required>
              <select className={SELECT_CLASS} {...form.register('roleKey')}>
                {ROLE_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {t(`usersPage.roleLabels.${k}`)}
                  </option>
                ))}
              </select>
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
          {roleKey === 'doktor' && (
            <div className="space-y-3 rounded-lg border border-dashed bg-muted/30 p-3">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  label={t('usersPage.create.fields.specialty')}
                  required
                  error={form.formState.errors.doctor?.specialty?.message}
                >
                  <Input {...form.register('doctor.specialty')} />
                </FormField>
                <FormField label={t('usersPage.create.fields.doctorType')} required>
                  <select className={SELECT_CLASS} {...form.register('doctor.type')}>
                    <option value="local">{t('usersPage.doctorTypes.local')}</option>
                    <option value="visiting">{t('usersPage.doctorTypes.visiting')}</option>
                  </select>
                </FormField>
              </div>
              {form.watch('doctor.type') === 'visiting' && (
                <p className="text-xs text-muted-foreground">{t('usersPage.visitingHint')}</p>
              )}
            </div>
          )}
          <div className="mt-4 flex flex-row justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('usersPage.create.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {t('usersPage.create.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
