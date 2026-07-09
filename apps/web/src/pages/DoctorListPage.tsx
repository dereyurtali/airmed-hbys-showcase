import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Plus, Search, Stethoscope } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
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
import { usePermission } from '../hooks/usePermission';
import { trpc } from '../lib/trpc';

const PAGE_SIZE = 20;

export function DoctorListPage() {
  const { t } = useTranslation(['doctor', 'common']);
  const navigate = useNavigate();
  // S10a — Permission registry (P1 #3.31): hardcode role check kaldırıldı.
  const canCreate = usePermission('action:doctor.create');

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const tt = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(tt);
  }, [searchInput]);

  const list = trpc.doctor.list.useQuery({
    search: debouncedSearch || undefined,
    isActive: showInactive ? undefined : true,
    page,
    pageSize: PAGE_SIZE,
  });

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;

  const typeShortLabel = (type: string): string => {
    if (type === 'local') return t('doctor:type.shortLocal');
    if (type === 'visiting') return t('doctor:type.shortVisiting');
    if (type === 'referral') return t('doctor:type.shortReferral');
    return type;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('doctor:list.title')}
        description={
          list.data
            ? t('doctor:list.countDescription', { count: list.data.total })
            : t('common:states.loading')
        }
        actions={
          canCreate && (
            <Button asChild>
              <Link to="/doctors/new">
                <Plus className="mr-2 h-4 w-4" />
                {t('doctor:list.newDoctor')}
              </Link>
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('doctor:list.searchPlaceholder')}
            className="pl-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          {t('doctor:list.showInactive')}
        </label>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('doctor:list.columns.fullName')}</TableHead>
              <TableHead>{t('doctor:list.columns.specialty')}</TableHead>
              <TableHead>{t('doctor:list.columns.type')}</TableHead>
              <TableHead>{t('doctor:list.columns.contact')}</TableHead>
              <TableHead>{t('doctor:list.columns.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading &&
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
                    <span>{t('doctor:list.loadFailed', { message: list.error.message })}</span>
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
                    icon={<Stethoscope className="h-8 w-8" />}
                    title={
                      debouncedSearch
                        ? t('doctor:list.noResultsForQuery', { query: debouncedSearch })
                        : t('doctor:list.empty')
                    }
                  />
                </TableCell>
              </TableRow>
            )}

            {list.data?.items.map((d) => (
              <TableRow
                key={d.id}
                className="cursor-pointer"
                onClick={() => navigate(`/doctors/${d.id}`)}
              >
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell>{d.specialty}</TableCell>
                <TableCell className="text-muted-foreground">{typeShortLabel(d.type)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {d.contactPhone || d.contactEmail || '—'}
                </TableCell>
                <TableCell>
                  {d.isActive ? (
                    <Badge variant="success">{t('doctor:list.status.active')}</Badge>
                  ) : (
                    <Badge variant="neutral">{t('doctor:list.status.inactive')}</Badge>
                  )}
                </TableCell>
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
