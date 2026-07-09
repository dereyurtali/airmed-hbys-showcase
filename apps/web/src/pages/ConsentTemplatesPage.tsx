import { useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageHeader } from '../components/layout/PageHeader';
import { trpc } from '../lib/trpc';

interface TemplateRow {
  id: string;
  procedureType: 'cataract' | 'retina' | 'laser' | 'intravitreal' | 'refractive' | 'general';
  language: 'tr' | 'ru' | 'tg';
  version: number;
  title: string;
  content: string;
  isActive: boolean;
  createdBy: { id: string; name: string } | null;
}

const PROCEDURE_TYPES = [
  'cataract',
  'retina',
  'laser',
  'intravitreal',
  'refractive',
  'general',
] as const;
const LANGUAGES = ['tr', 'ru', 'tg'] as const;

export function ConsentTemplatesPage() {
  const { t } = useTranslation(['consent', 'common']);
  const utils = trpc.useUtils();

  const [filterProc, setFilterProc] = useState<string>('');
  const [filterLang, setFilterLang] = useState<string>('');
  const [includeInactive, setIncludeInactive] = useState(false);

  const list = trpc.consent.listTemplates.useQuery({
    procedureType: (filterProc || undefined) as (typeof PROCEDURE_TYPES)[number] | undefined,
    language: (filterLang || undefined) as (typeof LANGUAGES)[number] | undefined,
    includeInactive,
  });

  const items = (list.data as TemplateRow[] | undefined) ?? [];

  const [creating, setCreating] = useState(false);
  // #402 — Şablon silme teyitsizdi (tek tık kalıcı). ConfirmDialog ile sar.
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [form, setForm] = useState({
    procedureType: 'cataract' as (typeof PROCEDURE_TYPES)[number],
    language: 'tr' as (typeof LANGUAGES)[number],
    title: '',
    content: '',
  });

  const create = trpc.consent.createTemplate.useMutation({
    onSuccess: async () => {
      toast.success(t('consent:toast.templateCreated'));
      setCreating(false);
      setForm({ procedureType: 'cataract', language: 'tr', title: '', content: '' });
      await utils.consent.listTemplates.invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof TRPCClientError ? err.message : t('consent:errors.unknown')),
  });

  const update = trpc.consent.updateTemplate.useMutation({
    onSuccess: async () => {
      toast.success(t('consent:toast.templateUpdated'));
      await utils.consent.listTemplates.invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof TRPCClientError ? err.message : t('consent:errors.unknown')),
  });

  const del = trpc.consent.deleteTemplate.useMutation({
    onSuccess: async () => {
      toast.success(t('consent:toast.templateDeleted'));
      setDeleteTarget(null);
      await utils.consent.listTemplates.invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof TRPCClientError ? err.message : t('consent:errors.unknown')),
  });

  const grouped = useMemo(() => {
    const m = new Map<string, TemplateRow[]>();
    for (const tpl of items) {
      const key = `${tpl.procedureType}|${tpl.language}`;
      const arr = m.get(key) ?? [];
      arr.push(tpl);
      m.set(key, arr);
    }
    return Array.from(m.entries()).map(([k, v]) => {
      const [procedureType, language] = k.split('|') as [string, string];
      return { procedureType, language, items: v.sort((a, b) => b.version - a.version) };
    });
  }, [items]);

  return (
    <div className="space-y-4">
      <PageHeader title={t('consent:templates.pageTitle')} />

      <section className="flex flex-wrap items-end gap-3 rounded-lg border bg-background p-4">
        <div>
          <Label htmlFor="filter-proc">{t('consent:dialog.procedureType')}</Label>
          <select
            id="filter-proc"
            className="flex h-9 w-40 focus-ring rounded-lg border border-field bg-background px-2 text-sm hover:border-field-hover"
            value={filterProc}
            onChange={(e) => setFilterProc(e.target.value)}
          >
            <option value="">{t('common:actions.all', 'Tümü')}</option>
            {PROCEDURE_TYPES.map((p) => (
              <option key={p} value={p}>
                {t(`consent:procedure.${p}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="filter-lang">{t('consent:dialog.language')}</Label>
          <select
            id="filter-lang"
            className="flex h-9 w-28 focus-ring rounded-lg border border-field bg-background px-2 text-sm hover:border-field-hover"
            value={filterLang}
            onChange={(e) => setFilterLang(e.target.value)}
          >
            <option value="">{t('common:actions.all', 'Tümü')}</option>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <label className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          {t('common:actions.includeInactive', 'Pasifleri göster')}
        </label>
        <Button className="ml-auto" onClick={() => setCreating((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" />
          {t('consent:templates.newButton')}
        </Button>
      </section>

      {creating && (
        <section className="space-y-3 rounded-lg border bg-background p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="new-proc">{t('consent:dialog.procedureType')}</Label>
              <select
                id="new-proc"
                className="flex h-9 w-full focus-ring rounded-lg border border-field bg-background px-2 text-sm hover:border-field-hover"
                value={form.procedureType}
                onChange={(e) =>
                  setForm({ ...form, procedureType: e.target.value as typeof form.procedureType })
                }
              >
                {PROCEDURE_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {t(`consent:procedure.${p}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="new-lang">{t('consent:dialog.language')}</Label>
              <select
                id="new-lang"
                className="flex h-9 w-full focus-ring rounded-lg border border-field bg-background px-2 text-sm hover:border-field-hover"
                value={form.language}
                onChange={(e) =>
                  setForm({ ...form, language: e.target.value as typeof form.language })
                }
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="new-title">{t('consent:templates.form.title')}</Label>
            <Input
              id="new-title"
              value={form.title}
              maxLength={200}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="new-content">{t('consent:templates.form.content')}</Label>
            <textarea
              id="new-content"
              className="focus-ring flex min-h-[180px] w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
              value={form.content}
              maxLength={50_000}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreating(false)}>
              {t('consent:templates.form.cancel')}
            </Button>
            <Button
              onClick={() => create.mutate(form)}
              disabled={create.isPending || form.title.length < 1 || form.content.length < 10}
            >
              {create.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {t('consent:templates.form.save')}
            </Button>
          </div>
        </section>
      )}

      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('common:loading')}</p>
      ) : list.error ? (
        <p className="rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm text-critical-foreground">
          {list.error.message}
        </p>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('consent:templates.empty')}</p>
      ) : (
        <div className="space-y-3">
          {grouped.map((g) => (
            <section
              key={`${g.procedureType}-${g.language}`}
              className="rounded-lg border bg-background p-4"
            >
              <h3 className="mb-2 text-sm font-semibold">
                {t(`consent:procedure.${g.procedureType as (typeof PROCEDURE_TYPES)[number]}`)} ·{' '}
                {g.language.toUpperCase()}
              </h3>
              <ul className="divide-y">
                {g.items.map((tpl) => (
                  <li key={tpl.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <div className="font-medium">
                        {tpl.title}{' '}
                        <span className="text-xs text-muted-foreground">
                          (v{tpl.version} ·{' '}
                          {tpl.isActive
                            ? t('consent:templates.active')
                            : t('consent:templates.inactive')}
                          )
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {tpl.content.slice(0, 150)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: tpl.id, isActive: !tpl.isActive })}
                      >
                        {tpl.isActive
                          ? t('consent:templates.deactivate')
                          : t('consent:templates.activate')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-destructive"
                        disabled={del.isPending}
                        onClick={() => setDeleteTarget({ id: tpl.id, title: tpl.title })}
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        {t('consent:templates.delete')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          title={t('consent:templates.deleteTitle', { defaultValue: 'Onam şablonu sil' })}
          description={t('consent:templates.deleteConfirm', {
            title: deleteTarget.title,
            defaultValue: `"${deleteTarget.title}" şablonu silinsin mi? Bu işlem geri alınamaz.`,
          })}
          confirmLabel={t('consent:templates.delete')}
          variant="destructive"
          onConfirm={() => del.mutate({ id: deleteTarget.id })}
        />
      )}
    </div>
  );
}
