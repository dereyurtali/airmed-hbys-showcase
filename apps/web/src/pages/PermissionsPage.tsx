import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Loader2, X, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { permissionLabel } from '@airmed/contracts';
import { useAuth } from '../providers/AuthProvider';
import { useConfirm } from '../hooks/useConfirm';
import { trpc } from '../lib/trpc';

// #402 — Kendini-kilitleme koruması: yönetici kendi rolünden yetki-yönetimi
// (veya admin ayarları) erişimini kapatırsa bir daha bu ekrana giremez.
const SELF_LOCK_RESOURCES = ['page:permissions', 'page:adminSettings', 'action:permission.toggle'];

// S14 — v0.1 Permissions matrisi port. v0.1 sürümü 6 tab vardı; v0.2 ilk
// port: tek tab (page:* ekran erişimi matrisi). Action/view override'ları
// ileri faz.
//
// Backend: trpc.permission.matrix (read) + trpc.permission.toggle (write).
// Override null = default davranış; true/false = override.

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

type TabKey = 'page' | 'action' | 'view';

export function PermissionsPage() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const myRoles = user?.roles ?? [];
  const [tab, setTab] = useState<TabKey>('page');
  const prefix = tab === 'page' ? 'page:' : tab === 'action' ? 'action:' : 'view:';

  const matrixQuery = trpc.permission.matrix.useQuery({ resourcePrefix: prefix });
  const toggleMutation = trpc.permission.toggle.useMutation();
  const utils = trpc.useUtils();

  // Resource'ları gruplandır: her resource için 6 rol cell'i
  const grouped = useMemo(() => {
    if (!matrixQuery.data)
      return new Map<string, Map<string, { defaultAllowed: boolean; override: boolean | null }>>();
    const m = new Map<string, Map<string, { defaultAllowed: boolean; override: boolean | null }>>();
    for (const cell of matrixQuery.data) {
      if (!m.has(cell.resource)) m.set(cell.resource, new Map());
      m.get(cell.resource)!.set(cell.roleKey, {
        defaultAllowed: cell.defaultAllowed,
        override: cell.overrideAllowed,
      });
    }
    return m;
  }, [matrixQuery.data]);

  const isPending = (resource: string, roleKey: string) =>
    toggleMutation.isPending &&
    toggleMutation.variables?.resource === resource &&
    toggleMutation.variables?.roleKey === roleKey;

  const handleToggle = async (roleKey: string, resource: string, currentEffective: boolean) => {
    const willDisable = currentEffective; // toggle kapatıyor
    // #402 — Kendi rolünden kritik yönetim erişimini kapatma uyarısı (kilitlenme).
    if (willDisable && myRoles.includes(roleKey) && SELF_LOCK_RESOURCES.includes(resource)) {
      const ok = await confirm({
        message: t('permissionsPage.confirmSelfLock'),
        destructive: true,
      });
      if (!ok) return;
    }
    toggleMutation.mutate(
      { roleKey: roleKey as (typeof ROLE_KEYS)[number], resource, allowed: !currentEffective },
      { onSuccess: () => utils.permission.matrix.invalidate() },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('permissionsPage.title')}
        description={t('permissionsPage.description')}
      />

      {/* Runtime davranış bilgilendirmesi — override'lar artık etkili oluyor. */}
      <div
        className="flex items-start gap-3 rounded-lg border border-info-border bg-info-bg p-3 text-sm text-info-foreground"
        role="status"
        aria-live="polite"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
        <div className="space-y-1">
          <div className="font-semibold">{t('permissionsPage.infoTitle')}</div>
          <p className="text-xs leading-relaxed text-sky-800">{t('permissionsPage.infoBody')}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={tab === 'page' ? 'default' : 'outline'}
          onClick={() => setTab('page')}
        >
          {t('permissionsPage.tabPage')}
        </Button>
        <Button
          size="sm"
          variant={tab === 'action' ? 'default' : 'outline'}
          onClick={() => setTab('action')}
        >
          {t('permissionsPage.tabAction')}
        </Button>
        <Button
          size="sm"
          variant={tab === 'view' ? 'default' : 'outline'}
          onClick={() => setTab('view')}
        >
          {t('permissionsPage.tabView')}
        </Button>
        <div className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" aria-hidden />
          {t('permissionsPage.adminOnly')}
        </div>
      </div>

      {matrixQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('permissionsPage.loading')}
        </div>
      ) : matrixQuery.error ? (
        <div className="rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm text-critical-foreground">
          {t('permissionsPage.loadFailed', { message: matrixQuery.error.message })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <Table className="min-w-full text-sm">
            <TableHeader className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <TableRow>
                <TableHead className="px-3 py-2 text-left sticky left-0 bg-muted/40">
                  {t('permissionsPage.resource')}
                </TableHead>
                {ROLE_KEYS.map((r) => (
                  <TableHead key={r} className="px-3 py-2 text-center min-w-[7rem]">
                    {t(`permissionsPage.roles.${r}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border">
              {Array.from(grouped.keys())
                .map((resource) => ({ resource, label: permissionLabel(resource) }))
                .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
                .map(({ resource, label }) => {
                  const cells = grouped.get(resource)!;
                  return (
                    <TableRow key={resource} className="hover:bg-muted/50">
                      <TableCell
                        className="px-3 py-2 sticky left-0 bg-inherit max-w-[28rem]"
                        title={resource}
                      >
                        <div className="text-sm text-foreground">{label}</div>
                        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                          {resource}
                        </div>
                      </TableCell>
                      {ROLE_KEYS.map((r) => {
                        const c = cells.get(r);
                        if (!c)
                          return (
                            <TableCell key={r} className="px-3 py-2 text-center text-slate-300">
                              —
                            </TableCell>
                          );
                        const effective = c.override ?? c.defaultAllowed;
                        const isOverridden = c.override !== null;
                        const pending = isPending(resource, r);
                        return (
                          <TableCell key={r} className="px-3 py-2 text-center">
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => void handleToggle(r, resource, effective)}
                              className={
                                'inline-flex items-center justify-center h-7 w-7 rounded-lg border transition ' +
                                (effective
                                  ? 'border-success-border bg-success-bg text-success-foreground'
                                  : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted') +
                                (isOverridden ? ' ring-2 ring-warning-border' : '') +
                                (pending ? ' opacity-50 cursor-wait' : ' cursor-pointer')
                              }
                              title={
                                isOverridden
                                  ? t('permissionsPage.overrideTitle', {
                                      state: c.defaultAllowed
                                        ? t('permissionsPage.stateOpen')
                                        : t('permissionsPage.stateClosed'),
                                    })
                                  : effective
                                    ? t('permissionsPage.defaultOpen')
                                    : t('permissionsPage.defaultClosed')
                              }
                            >
                              {pending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : effective ? (
                                <Check className="h-4 w-4" />
                              ) : (
                                <X className="h-4 w-4" />
                              )}
                            </button>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
          {grouped.size === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {t('permissionsPage.emptyCategory')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
