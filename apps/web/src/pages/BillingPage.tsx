import { localeToIntl, getDateTimeFormat } from '../lib/i18n-format';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Receipt, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { InvoiceCreateDialog } from '../components/billing/InvoiceCreateDialog';
import { EmptyState } from '../components/ui/empty-state';
import { useAuth } from '../providers/AuthProvider';
import { ROLES } from '@airmed/contracts';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { INVOICE_STATUS_COLORS, formatMoney, type InvoiceStatus } from '../lib/billing.constants';
import { billingApi, type InvoiceRow } from '../lib/billing.trpc';
type StatusKey = InvoiceStatus;
import { usePermission } from '../hooks/usePermission';
import { useLocale } from '../providers/LocaleProvider';

const STATUSES: StatusKey[] = [
  'open',
  'partial',
  'paid',
  'cancelled',
  'refunded',
  'pending_approval',
];

export function BillingPage() {
  const { t } = useTranslation(['billing', 'common']);
  const { locale } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const canCreate = usePermission('action:invoice.create');
  // v0.4.2 R7 (Karar 7 + mali izolasyon) — sadece-finans: hasta adı/klinik linki
  // gizli, yalnız MRN + fatura/ödeme ID. Yönetici/asistan/resepsiyon tam görür.
  const { user } = useAuth();
  const isFinanceIsolated =
    !!user?.roles.includes(ROLES.FINANS) &&
    !user.roles.some(
      (r) => r === ROLES.YONETICI || r === ROLES.YONETICI_ASISTANI || r === ROLES.RESEPSIYON,
    );

  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusKey | ''>(
    (searchParams.get('status') as StatusKey | null) ?? '',
  );
  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  // #401 — Server-side arama: 300ms debounce + sayfa bazlı "Daha fazla yükle".
  // Eskiden yalnız ilk 50 client-side filtreleniyordu → eski faturalar kayıptı.
  const [debounced, setDebounced] = useState(search.trim());
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [debounced, statusFilter]);

  const listQuery = billingApi.listInvoices.useQuery({
    status: statusFilter || undefined,
    search: debounced || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  // Sayfalar accumulator'da birikir (load-more). page=1 (filtre değişimi) sıfırlar.
  const [accum, setAccum] = useState<InvoiceRow[]>([]);
  useEffect(() => {
    if (!listQuery.data) return;
    const items = listQuery.data.items;
    setAccum((prev) => {
      if (page === 1) return items;
      const seen = new Set(prev.map((i) => i.id));
      return [...prev, ...items.filter((i) => !seen.has(i.id))];
    });
  }, [listQuery.data, page]);

  const total = listQuery.data?.total ?? 0;
  const hasMore = accum.length < total;
  const dateFmt = getDateTimeFormat(localeToIntl(locale) ?? 'tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('billing:invoice.title')}
        description={t('billing:invoice.subtitle')}
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t('billing:invoice.new')}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              const params = new URLSearchParams(searchParams);
              if (e.target.value) params.set('q', e.target.value);
              else params.delete('q');
              setSearchParams(params);
            }}
            placeholder={
              isFinanceIsolated
                ? t('billing:invoice.number')
                : t('billing:invoice.number') + ' / ' + t('billing:invoice.patient')
            }
            className="pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            const v = e.target.value as StatusKey | '';
            setStatusFilter(v);
            const params = new URLSearchParams(searchParams);
            if (v) params.set('status', v);
            else params.delete('status');
            setSearchParams(params);
          }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">{t('billing:invoice.status')} —</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`billing:invoice.statusLabel.${s}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('billing:invoice.number')}</TableHead>
              <TableHead>{t('billing:invoice.patient')}</TableHead>
              <TableHead className="text-right">{t('billing:invoice.total')}</TableHead>
              <TableHead>{t('billing:invoice.status')}</TableHead>
              <TableHead>{t('billing:invoice.createdAt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading && accum.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  {t('common:states.loading')}
                </TableCell>
              </TableRow>
            )}
            {listQuery.error && (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {t('billing:invoice.loadFailed', { message: listQuery.error.message })}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!listQuery.isLoading && accum.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState
                    icon={<Receipt className="h-8 w-8 opacity-40" />}
                    title={t('billing:invoice.noInvoices')}
                  />
                </TableCell>
              </TableRow>
            )}
            {accum.map((inv: InvoiceRow) => (
              <TableRow key={inv.id}>
                <TableCell className="font-mono">
                  <Link to={`/billing/${inv.id}`} className="text-primary hover:underline">
                    {inv.invoiceNumber}
                  </Link>
                </TableCell>
                <TableCell>
                  {isFinanceIsolated ? (
                    // Mali izolasyon (R7): hasta adı + klinik linki gizli, yalnız MRN.
                    <span className="font-mono text-sm text-muted-foreground">
                      {inv.patient.mrn}
                    </span>
                  ) : (
                    <>
                      <Link to={`/patients/${inv.patient.id}`} className="hover:underline">
                        {inv.patient.firstName} {inv.patient.lastName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{inv.patient.mrn}</div>
                    </>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatMoney(inv.total, inv.currency, localeToIntl(locale))}
                </TableCell>
                <TableCell>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      INVOICE_STATUS_COLORS[inv.status as InvoiceStatus]
                    }`}
                  >
                    {t(`billing:invoice.statusLabel.${inv.status}`)}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {dateFmt.format(new Date(inv.createdAt))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {hasMore && (
          <div className="flex justify-center border-t p-3">
            <Button
              variant="outline"
              size="sm"
              disabled={listQuery.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              {listQuery.isFetching
                ? t('common:states.loading')
                : t('billing:invoice.loadMore', {
                    defaultValue: 'Daha fazla yükle',
                    loaded: accum.length,
                    total,
                  })}
            </Button>
          </div>
        )}
      </div>

      {createOpen && (
        <InvoiceCreateDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(inv) => {
            toast.success(t('billing:invoice.createdToast', { number: inv.invoiceNumber }));
            setPage(1);
            void listQuery.refetch();
            setCreateOpen(false);
          }}
        />
      )}
    </div>
  );
}
