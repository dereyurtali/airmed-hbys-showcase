import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import { localeToIntl } from '../../lib/i18n-format';
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { MeasurementForm, type ExistingMeasurement } from './MeasurementForm';
import {
  isSupportedFormType,
  isWithinSameDayWindow,
  summarizeValues,
  type MeasurementType,
  type MeasurementValues,
} from '../../lib/measurement.constants';
import { trpc } from '../../lib/trpc';
import { usePermissions } from '../../hooks/usePermission';
import { useLocale } from '../../providers/LocaleProvider';

interface HistoryItem {
  id: string;
  type: MeasurementType;
  measuredAt: string | Date;
  values: unknown;
  notes: string | null;
  measuredById: string | null;
  measuredBy: { id: string; name: string; email: string } | null;
}

interface Props {
  patientId: string;
}

export function MeasurementHistory({ patientId }: Props) {
  const { t } = useTranslation(['measurement', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';

  const list = trpc.measurement.listByPatient.useQuery({ patientId });

  // Delta audit A-5: hardcoded role-array `.includes(r)` pattern'i kaldırıldı,
  // permission registry kullanılır. `isAdmin` (yönetici override) tek role
  // bazlı kaldı — backend `action:measurement.adminEdit` izni eklenince
  // migrate edilecek (P2 takip).
  const perms = usePermissions(['action:measurement.create', 'action:measurement.update']);
  const canEditAny = perms['action:measurement.create'] || perms['action:measurement.update'];
  const me = trpc.auth.me.useQuery();
  const isAdmin = (me.data?.roles ?? []).includes('yonetici');
  const myUserId = me.data?.sub;

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ExistingMeasurement | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | MeasurementType>('all');

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

  const isEditable = (m: HistoryItem) => {
    if (!canEditAny) return false;
    if (isAdmin) return true;
    // Sahibi olmayan + admin değil → düzenleyemez
    if (m.measuredById !== myUserId) return false;
    return isWithinSameDayWindow(m.measuredAt);
  };

  const items = useMemo(() => {
    const raw = (list.data as HistoryItem[] | undefined) ?? [];
    if (typeFilter === 'all') return raw;
    return raw.filter((m) => m.type === typeFilter);
  }, [list.data, typeFilter]);

  const typesInData = useMemo(() => {
    const set = new Set<MeasurementType>();
    for (const m of (list.data as HistoryItem[] | undefined) ?? []) set.add(m.type);
    return Array.from(set);
  }, [list.data]);

  return (
    <section className="space-y-3" aria-labelledby="measurement-heading">
      <header className="flex items-center justify-between gap-2">
        <h2 id="measurement-heading" className="text-lg font-semibold">
          {t('measurement:section.title')}
        </h2>
        <div className="flex items-center gap-2">
          {typesInData.length > 1 && (
            <select
              data-testid="measurement-type-filter"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | MeasurementType)}
              className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="all">{t('measurement:section.allTypes')}</option>
              {typesInData.map((tk) => (
                <option key={tk} value={tk}>
                  {t(`measurement:types.${tk}`)}
                </option>
              ))}
            </select>
          )}
          {canEditAny && me.data && (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="measurement-new">
              <Plus className="mr-1 h-4 w-4" />
              {t('measurement:section.newButton')}
            </Button>
          )}
        </div>
      </header>

      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('measurement:section.loading')}</p>
      ) : list.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {list.error.message}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('measurement:section.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <Table className="w-full text-sm">
            <TableHeader className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <TableRow>
                <TableHead scope="col" className="px-3 py-2 text-left">
                  {t('measurement:table.measuredAt')}
                </TableHead>
                <TableHead scope="col" className="px-3 py-2 text-left">
                  {t('measurement:table.type')}
                </TableHead>
                <TableHead scope="col" className="px-3 py-2 text-left">
                  {t('measurement:table.value')}
                </TableHead>
                <TableHead scope="col" className="px-3 py-2 text-left">
                  {t('measurement:table.measuredBy')}
                </TableHead>
                <TableHead scope="col" className="px-3 py-2 text-right">
                  {' '}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((m) => {
                const editable = isEditable(m);
                const values = (m.values as MeasurementValues) ?? {};
                const formType = isSupportedFormType(m.type) ? m.type : null;
                return (
                  <TableRow key={m.id} className="border-t">
                    <TableCell className="px-3 py-2 align-top whitespace-nowrap">
                      {fmtDateTime(m.measuredAt)}
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top">
                      {t(`measurement:types.${m.type}`)}
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top">
                      {summarizeValues(m.type, values)}
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top text-muted-foreground">
                      {m.measuredBy?.name ?? '—'}
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top text-right">
                      {editable && formType && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setEditing({
                              id: m.id,
                              type: formType,
                              eyeSide: (m as { eyeSide?: 'od' | 'os' | 'ou' }).eyeSide ?? 'ou',
                              measuredAt: new Date(m.measuredAt),
                              values,
                              notes: m.notes,
                            })
                          }
                        >
                          {t('common:actions.edit')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {createOpen && me.data && (
        <MeasurementForm
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="create"
          patientId={patientId}
          onSaved={() => setCreateOpen(false)}
        />
      )}

      {editing && me.data && (
        <MeasurementForm
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          mode="edit"
          patientId={patientId}
          existing={editing}
          onSaved={() => setEditing(null)}
        />
      )}
    </section>
  );
}
