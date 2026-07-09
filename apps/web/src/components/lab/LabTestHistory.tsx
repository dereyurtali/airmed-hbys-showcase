import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import { localeToIntl } from '../../lib/i18n-format';
import { useMemo, useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { LabTestForm, type ExistingLabTest } from './LabTestForm';
import {
  isWithinSameDayWindow,
  summarizeResults,
  type LabTestSource,
  type LabTestType,
} from '../../lib/lab.constants';
import { api } from '../../lib/api';
import { trpc } from '../../lib/trpc';
import { usePermissions } from '../../hooks/usePermission';
import { useLocale } from '../../providers/LocaleProvider';

interface HistoryItem {
  id: string;
  source: LabTestSource;
  testType: LabTestType;
  performedAt: string | Date;
  results: unknown;
  notes: string | null;
  externalLab: string | null;
  fileKey: string | null;
  fileName: string | null;
  fileMimeType: string | null;
  createdAt: string | Date;
  createdById: string | null;
  createdBy: { id: string; name: string } | null;
}

interface Props {
  patientId: string;
}

export function LabTestHistory({ patientId }: Props) {
  const { t } = useTranslation(['lab', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';

  const list = trpc.lab.listByPatient.useQuery({ patientId });

  // Delta audit A-5: hardcoded role-array `.includes(r)` pattern'i kaldırıldı,
  // permission registry kullanılır. `isAdmin` tek role kalın — P2 takip.
  const perms = usePermissions(['action:lab.request', 'action:lab.update']);
  const canEdit = perms['action:lab.request'] || perms['action:lab.update'];
  const me = trpc.auth.me.useQuery();
  const isAdmin = (me.data?.roles ?? []).includes('yonetici');
  const myUserId = me.data?.sub;

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ExistingLabTest | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | LabTestType>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | LabTestSource>('all');

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

  const isEditable = (it: HistoryItem) => {
    if (!canEdit) return false;
    if (isAdmin) return true;
    if (it.createdById !== myUserId) return false;
    return isWithinSameDayWindow(it.createdAt);
  };

  const items = useMemo(() => {
    const raw = (list.data as HistoryItem[] | undefined) ?? [];
    return raw.filter((it) => {
      if (typeFilter !== 'all' && it.testType !== typeFilter) return false;
      if (sourceFilter !== 'all' && it.source !== sourceFilter) return false;
      return true;
    });
  }, [list.data, typeFilter, sourceFilter]);

  const typesInData = useMemo(() => {
    const set = new Set<LabTestType>();
    for (const it of (list.data as HistoryItem[] | undefined) ?? []) set.add(it.testType);
    return Array.from(set);
  }, [list.data]);

  const onDownload = async (id: string, fileName: string | null) => {
    try {
      const res = await api.get(`/lab-tests/${id}/file`, { responseType: 'blob' });
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName ?? 'lab-test';
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* swallow — toast covered via UI elsewhere */
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="lab-heading">
      <header className="flex items-center justify-between gap-2">
        <h2 id="lab-heading" className="text-lg font-semibold">
          {t('lab:section.title')}
        </h2>
        {canEdit && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('lab:section.new')}
          </Button>
        )}
      </header>

      {(typesInData.length > 0 || items.length > 0) && (
        <div className="flex flex-wrap gap-2">
          <select
            className="focus-ring h-9 rounded-lg border border-field bg-background px-2 text-sm hover:border-field-hover"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | LabTestType)}
          >
            <option value="all">{t('lab:filter.allTypes')}</option>
            {typesInData.map((tt) => (
              <option key={tt} value={tt}>
                {t(`lab:types.${tt}`)}
              </option>
            ))}
          </select>
          <select
            className="focus-ring h-9 rounded-lg border border-field bg-background px-2 text-sm hover:border-field-hover"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as 'all' | LabTestSource)}
          >
            <option value="all">{t('lab:filter.allSources')}</option>
            <option value="internal">{t('lab:source.internal')}</option>
            <option value="external">{t('lab:source.external')}</option>
          </select>
        </div>
      )}

      <div className="rounded-lg border bg-background">
        {list.isLoading && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('common:actions.loading')}
          </p>
        )}
        {!list.isLoading && items.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('lab:section.empty')}
          </p>
        )}
        {items.length > 0 && (
          <Table className="w-full text-sm">
            <TableHeader className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <TableRow>
                <TableHead className="px-4 py-2">{t('lab:table.performedAt')}</TableHead>
                <TableHead className="px-4 py-2">{t('lab:table.type')}</TableHead>
                <TableHead className="px-4 py-2">{t('lab:table.source')}</TableHead>
                <TableHead className="px-4 py-2">{t('lab:table.summary')}</TableHead>
                <TableHead className="px-4 py-2">{t('lab:table.createdBy')}</TableHead>
                <TableHead className="px-4 py-2"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <TableCell className="px-4 py-2 whitespace-nowrap">
                    {fmtDateTime(it.performedAt)}
                  </TableCell>
                  <TableCell className="px-4 py-2">{t(`lab:types.${it.testType}`)}</TableCell>
                  <TableCell className="px-4 py-2 text-xs text-muted-foreground">
                    {t(`lab:source.${it.source}`)}
                    {it.externalLab ? ` · ${it.externalLab}` : ''}
                  </TableCell>
                  <TableCell className="px-4 py-2">
                    {summarizeResults(it.testType, it.results, it.notes)}
                  </TableCell>
                  <TableCell className="px-4 py-2 text-xs text-muted-foreground">
                    {it.createdBy?.name ?? '—'}
                  </TableCell>
                  <TableCell className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {it.fileKey && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onDownload(it.id, it.fileName)}
                          aria-label={t('lab:actions.download')}
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      )}
                      {isEditable(it) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setEditing({
                              id: it.id,
                              source: it.source,
                              testType: it.testType,
                              performedAt: it.performedAt,
                              results: (it.results as Record<string, unknown> | null) ?? null,
                              notes: it.notes,
                              externalLab: it.externalLab,
                              fileName: it.fileName,
                            })
                          }
                        >
                          {t('lab:actions.edit')}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <LabTestForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        patientId={patientId}
        onSaved={() => undefined}
      />
      <LabTestForm
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        mode="edit"
        patientId={patientId}
        existing={editing}
        onSaved={() => setEditing(null)}
      />
    </section>
  );
}
