import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { localeToIntl } from '../lib/i18n-format';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { DateField } from '../components/ui/date-field';
import { Label } from '../components/ui/label';
import {
  PROCEDURE_TYPES,
  type EyeSide,
  type ProcedureStatus,
  type ProcedureType,
} from '../lib/procedure.constants';

interface ProcedureRow {
  id: string;
  type: ProcedureType;
  eyeSide: EyeSide;
  status: ProcedureStatus;
  performedAt: string | Date;
  patient: { id: string; mrn: string; firstName: string; lastName: string };
  doctor: { id: string; name: string };
}
import { trpc } from '../lib/trpc';
import { useLocale } from '../providers/LocaleProvider';

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function ProcedureListPage() {
  const { t } = useTranslation(['procedure', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';

  const [typeFilter, setTypeFilter] = useState<ProcedureType | ''>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const query = useMemo(
    () => ({
      type: (typeFilter || undefined) as ProcedureType | undefined,
      fromDate: fromDate ? new Date(fromDate).toISOString() : undefined,
      toDate: toDate ? new Date(toDate + 'T23:59:59').toISOString() : undefined,
      limit: 100,
    }),
    [typeFilter, fromDate, toDate],
  );

  const list = trpc.procedure.list.useQuery(query);
  const rows = (list.data ?? []) as unknown as ProcedureRow[];

  const fmtDateTime = (iso: string | Date) => {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    return d.toLocaleString(dateLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('procedure:listPage.title')}
        description={t('procedure:listPage.description')}
      />

      <section className="grid gap-3 rounded-md border bg-background p-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="procf-type">{t('procedure:form.fields.type')}</Label>
          <select
            id="procf-type"
            className={SELECT_CLASS}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as ProcedureType | '')}
          >
            <option value="">{t('procedure:listPage.allTypes')}</option>
            {PROCEDURE_TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {t(`procedure:types.${tp}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="procf-from">{t('procedure:listPage.fromDate')}</Label>
          <DateField id="procf-from" value={fromDate} onChange={setFromDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="procf-to">{t('procedure:listPage.toDate')}</Label>
          <DateField id="procf-to" value={toDate} onChange={setToDate} />
        </div>
      </section>

      <section>
        {list.isLoading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : list.error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {list.error.message}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('procedure:listPage.empty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border bg-background">
            <Table className="w-full text-sm">
              <TableHeader className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <TableRow>
                  <TableHead className="px-3 py-2">
                    {t('procedure:listPage.cols.performedAt')}
                  </TableHead>
                  <TableHead className="px-3 py-2">
                    {t('procedure:listPage.cols.patient')}
                  </TableHead>
                  <TableHead className="px-3 py-2">{t('procedure:listPage.cols.type')}</TableHead>
                  <TableHead className="px-3 py-2">
                    {t('procedure:listPage.cols.eyeSide')}
                  </TableHead>
                  <TableHead className="px-3 py-2">{t('procedure:listPage.cols.doctor')}</TableHead>
                  <TableHead className="px-3 py-2">{t('procedure:listPage.cols.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody data-testid="procedure-table-body">
                {rows.map((p) => (
                  <TableRow key={p.id} className="border-t">
                    <TableCell className="px-3 py-2 whitespace-nowrap">
                      {fmtDateTime(p.performedAt)}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <Link
                        to={`/patients/${p.patient.id}`}
                        className="text-primary hover:underline"
                      >
                        {p.patient.firstName} {p.patient.lastName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{p.patient.mrn}</div>
                    </TableCell>
                    <TableCell className="px-3 py-2">{t(`procedure:types.${p.type}`)}</TableCell>
                    <TableCell className="px-3 py-2">
                      {t(`procedure:eyeSide.${p.eyeSide}`)}
                    </TableCell>
                    <TableCell className="px-3 py-2">{p.doctor.name}</TableCell>
                    <TableCell className="px-3 py-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {t(`procedure:status.${p.status}`)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
