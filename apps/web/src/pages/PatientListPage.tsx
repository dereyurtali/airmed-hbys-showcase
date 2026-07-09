import { localeToIntl, getDateTimeFormat } from '../lib/i18n-format';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { PatientTagBadges } from '../components/patient/PatientTagBadges';
import { PatientTagPicker } from '../components/patient/PatientTagPicker';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState } from '../components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { keepPreviousData } from '@tanstack/react-query';
import { useLocale } from '../providers/LocaleProvider';
import { useAuth } from '../providers/AuthProvider';
import { usePermission } from '../hooks/usePermission';
import type { PatientTag } from '../lib/patient-tags.constants';
import { trpc } from '../lib/trpc';

const PAGE_SIZE = 20;

export function PatientListPage() {
  const { t } = useTranslation(['patient', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';
  const navigate = useNavigate();
  // Doktor hasta kaydı oluşturamaz → "Yeni Hasta" butonu gizli (read-only liste).
  const canCreate = usePermission('action:patient.create');
  // R1 (#723, Karar 2) — misafir doktor: liste backend'de kendi hastalarına
  // scope'lu (clinic-wide DEĞİL). UI illüzyonu olmasın diye scope banner'ı +
  // "listede yoksa erişim iste" yönlendirmesi göster.
  const { user } = useAuth();
  const isVisitingDoctor = user?.flags?.is_visiting_doctor === true;
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<PatientTag[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const tt = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(tt);
  }, [searchInput]);

  const list = trpc.patient.list.useQuery(
    {
      search: debouncedSearch || undefined,
      tags: tagFilter.length > 0 ? tagFilter : undefined,
      page,
      pageSize: PAGE_SIZE,
    },
    // Sayfa/arama değişince önceki satırlar ekranda kalsın (flash + scroll-reset
    // yok); iskelet yalnız ilk yüklemede (henüz veri yokken) gösterilir.
    { placeholderData: keepPreviousData },
  );

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;

  // #1067 — cache'li formatter (render başına Intl constructor yok).
  const dateFmt = getDateTimeFormat(dateLocale, {});
  const formatDate = (value: string | Date | null | undefined): string => {
    if (!value) return '—';
    const d = typeof value === 'string' ? new Date(value) : value;
    return dateFmt.format(d);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('patient:list.title')}
        description={
          list.data
            ? t('patient:list.countDescription', { count: list.data.total })
            : t('common:states.loading')
        }
        actions={
          canCreate ? (
            <Button asChild>
              <Link to="/patients/new">
                <Plus className="mr-2 h-4 w-4" />
                {t('patient:list.newPatient')}
              </Link>
            </Button>
          ) : undefined
        }
      />

      {isVisitingDoctor && (
        <div className="rounded-lg border border-info-border bg-info-bg px-3 py-2 text-sm text-info-foreground">
          {t('patient:list.visitingScopeNote')}
        </div>
      )}

      <div className="space-y-2">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('patient:list.searchPlaceholder')}
            className="pl-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {t('patient:list.filterByTag')}
            {tagFilter.length > 0 && ` (${tagFilter.length})`}
          </summary>
          <div className="mt-2">
            <PatientTagPicker
              value={tagFilter}
              onChange={(next) => {
                setTagFilter(next);
                setPage(1);
              }}
            />
          </div>
        </details>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('patient:list.columns.mrn')}</TableHead>
              <TableHead>{t('patient:list.columns.fullName')}</TableHead>
              <TableHead>{t('patient:list.columns.birthDate')}</TableHead>
              <TableHead>{t('patient:list.columns.phone')}</TableHead>
              <TableHead>{t('patient:list.columns.createdAt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading &&
              !list.data &&
              Array.from({ length: 3 }).map((_, idx) => (
                <TableRow key={`skeleton-${idx}`}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}

            {list.error && (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm text-critical-foreground">
                    <span>{t('patient:list.loadFailed', { message: list.error.message })}</span>
                    <Button size="sm" variant="outline" onClick={() => void list.refetch()}>
                      {t('common:actions.retry')}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}

            {list.data && list.data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState
                    title={
                      debouncedSearch
                        ? t('patient:list.noResultsForQuery', { query: debouncedSearch })
                        : t('patient:list.empty')
                    }
                    // R1 (#723, Karar 2) — misafir doktorda aranan hasta listede
                    // yoksa erişim isteme yönlendirmesi (clinic-wide arama yok).
                    description={
                      debouncedSearch && isVisitingDoctor
                        ? t('patient:list.visitingNoAccessHint')
                        : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            )}

            {list.data?.items.map((p) => (
              <TableRow
                key={p.id}
                className="cursor-pointer"
                onClick={() => navigate(`/patients/${p.id}`)}
              >
                <TableCell className="font-mono text-xs">{p.mrn}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span>
                      {p.firstName} {p.lastName}
                    </span>
                    <PatientTagBadges
                      tags={((p as { tags?: string[] }).tags ?? []) as string[]}
                      size="sm"
                    />
                  </div>
                </TableCell>
                <TableCell>{formatDate(p.birthDate)}</TableCell>
                <TableCell>{p.phone ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <footer className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t('common:pagination.page', { page, total: totalPages })}
          {list.isFetching && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t('common:actions.previous')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('common:actions.next')}
          </Button>
        </div>
      </footer>
    </div>
  );
}
