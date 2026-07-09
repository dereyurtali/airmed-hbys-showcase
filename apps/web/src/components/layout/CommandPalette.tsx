import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  Search,
  LayoutDashboard,
  Users,
  ClipboardList,
  CalendarDays,
  Stethoscope,
  CheckSquare,
  Receipt,
  Boxes,
  Store,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { usePermission, usePermissions } from '../../hooks/usePermission';
import { useAuth } from '../../providers/AuthProvider';
import { trpc } from '../../lib/trpc';
import type { Permission } from '@airmed/contracts';
import { hasMod } from '../../lib/hotkeys';

// #403 → v0.4.2 G3 (#722): hasta aramasından **rol-aware command palette**'e büyüdü.
// Cmd/Ctrl+K her ekrandan: (1) yetkili olduğu ana ekranlara atla (Git), (2) hasta ara.
// Komutlar permission-filtreli (sidebar gibi); "Genel Bakış" yetkisizdir (her rol görür).
// Kilitli kiosk (ölçüm modu) → palet yok (dışarı navigasyon ilkesi).

interface NavCommand {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** undefined → her rol görür (örn. Genel Bakış). */
  perm?: Permission;
}

const NAV_COMMANDS: readonly NavCommand[] = [
  { to: '/overview', labelKey: 'nav.overview', icon: LayoutDashboard },
  { to: '/worklist', labelKey: 'nav.examQueue', icon: Stethoscope, perm: 'page:worklist' },
  {
    to: '/reception-queue',
    labelKey: 'nav.receptionQueue',
    icon: ClipboardList,
    perm: 'page:receptionQueue',
  },
  { to: '/schedule', labelKey: 'nav.appointments', icon: CalendarDays, perm: 'page:schedule' },
  { to: '/patients', labelKey: 'nav.patients', icon: Users, perm: 'page:patients' },
  { to: '/approvals', labelKey: 'nav.approvals', icon: CheckSquare, perm: 'action:approval.list' },
  { to: '/billing', labelKey: 'nav.billing', icon: Receipt, perm: 'page:billing' },
  { to: '/inventory/iol', labelKey: 'nav.iolInventory', icon: Boxes, perm: 'page:iolInventory' },
  { to: '/pharmacy/pos', labelKey: 'nav.pharmacyPos', icon: Store, perm: 'page:pharmacyPos' },
];

const NAV_PERMS: readonly Permission[] = NAV_COMMANDS.map((c) => c.perm).filter(
  (p): p is Permission => !!p,
);

export function CommandPalette() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { user } = useAuth();
  const isLockedMode = user?.mode === 'olcum';
  const isVisitingDoctor = user?.flags?.is_visiting_doctor === true;
  const canSearchPatients = usePermission('page:patients') && !isVisitingDoctor;
  const perms = usePermissions(NAV_PERMS);

  const navCommands = useMemo(() => NAV_COMMANDS.filter((c) => !c.perm || perms[c.perm]), [perms]);

  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [debounced, setDebounced] = useState('');

  // Cmd/Ctrl+K aç/kapa — kilitli kiosk hariç.
  useEffect(() => {
    if (isLockedMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (hasMod(e) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isLockedMode]);

  useEffect(() => {
    const tt = setTimeout(() => setDebounced(searchInput.trim()), 250);
    return () => clearTimeout(tt);
  }, [searchInput]);

  useEffect(() => {
    if (!open) {
      setSearchInput('');
      setDebounced('');
    }
  }, [open]);

  const patientList = trpc.patient.list.useQuery(
    { search: debounced || undefined, page: 1, pageSize: 8 },
    { enabled: open && canSearchPatients && debounced.length >= 2 },
  );

  if (isLockedMode) return null;

  const q = debounced.toLowerCase();
  const filteredNav =
    q.length === 0
      ? navCommands
      : navCommands.filter((c) => t(c.labelKey).toLowerCase().includes(q));
  const patientItems =
    canSearchPatients && debounced.length >= 2 ? (patientList.data?.items ?? []) : [];
  const patientLoading = canSearchPatients && debounced.length >= 2 && patientList.isLoading;
  const nothing = filteredNav.length === 0 && patientItems.length === 0 && !patientLoading;

  const goRoute = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  const goPatient = (id: string) => {
    setOpen(false);
    navigate(`/patients/${id}`);
  };

  // #824 geri-bildirim: arama yapılırken (hasta sorgusu var) sonuçlar nav'dan
  // ÖNCE gelir → cmdk ilk öğeyi seçer → Enter doğrudan ilk hastaya gider
  // ("arama Enter'la çalışsın"). Sorgu yokken nav önce (hızlı ekran-atlama).
  const patientsFirst = canSearchPatients && debounced.length >= 2;

  const navGroup =
    filteredNav.length > 0 ? (
      <CommandGroup key="nav" heading={t('globalSearch.navHeading')}>
        {filteredNav.map((c) => {
          const Icon = c.icon;
          return (
            <CommandItem key={c.to} value={c.to} onSelect={() => goRoute(c.to)}>
              <Icon className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden />
              {t(c.labelKey)}
            </CommandItem>
          );
        })}
      </CommandGroup>
    ) : null;

  const patientGroup = patientsFirst ? (
    <CommandGroup key="patients" heading={t('globalSearch.patientsHeading')}>
      {patientLoading && (
        <div className="py-3 text-center text-xs text-muted-foreground">
          {t('globalSearch.loading')}
        </div>
      )}
      {patientItems.map((p) => (
        <CommandItem key={p.id} value={p.id} onSelect={() => goPatient(p.id)}>
          <span className="font-medium">
            {p.firstName} {p.lastName}
          </span>
          <span className="ml-2 text-xs text-muted-foreground">{p.mrn}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  ) : null;

  return (
    <>
      {/* Trigger native <button> → Space/Enter zaten açar (klavye erişilebilir).
          #824 geri-bildirim: biraz daha geniş + arama çubuğu gibi dursun. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('globalSearch.trigger')}
        className="focus-ring hidden items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted sm:flex sm:w-64 lg:w-80"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{t('globalSearch.trigger')}</span>
        <kbd className="ml-auto shrink-0 rounded border bg-muted px-1.5 text-[10px] font-medium tabular-nums">
          ⌘K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">{t('globalSearch.title')}</DialogTitle>
          <Command shouldFilter={false} className="rounded-none border-0">
            <CommandInput
              autoFocus
              placeholder={
                canSearchPatients ? t('globalSearch.placeholder') : t('globalSearch.navPlaceholder')
              }
              value={searchInput}
              onValueChange={setSearchInput}
            />
            <CommandList>
              {patientsFirst ? (
                <>
                  {patientGroup}
                  {navGroup}
                </>
              ) : (
                <>
                  {navGroup}
                  {patientGroup}
                </>
              )}

              {nothing && (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  {canSearchPatients && debounced.length > 0 && debounced.length < 2
                    ? t('globalSearch.minChars')
                    : t('globalSearch.noResults')}
                </div>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
