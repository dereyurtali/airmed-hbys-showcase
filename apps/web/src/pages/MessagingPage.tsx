import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { PageHeader } from '../components/layout/PageHeader';
import { confirmIfDirty } from '../hooks/useUnsavedWarning';
import { trpc } from '../lib/trpc';
import { useLocale } from '../providers/LocaleProvider';
import { formatDateTime } from '../lib/i18n-format';

// D1 PR 3 — Mesajlaşma admin sayfası.
// Üç sekme: Şablonlar (subject/body düzenle), Tetikleyiciler (isEnabled +
// quiet hours), Gönderimler (status/recipient filtre + audit).
// Sayfa /admin/messaging route'unda, yalnızca yonetici + yonetici_asistani
// erişebilir (RolesGuard route düzeyinde uygular).

type Tab = 'templates' | 'triggers' | 'deliveries';

const LANGUAGES = ['tr', 'ru', 'tg'] as const;
const CHANNELS = ['MOCK', 'SMS', 'WHATSAPP', 'EMAIL'] as const;
const CATEGORIES = ['RANDEVU', 'TETKIK', 'FATURA', 'ONAM', 'DIGER'] as const;
const STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'FAILED'] as const;

interface TemplateRow {
  id: string;
  triggerKey: string;
  language: string;
  channelType: string;
  subject: string | null;
  body: string;
  variables: string[];
  isActive: boolean;
}

interface TriggerRow {
  id: string;
  key: string;
  category: string;
  name: string;
  isEnabled: boolean;
  isMandatory: boolean;
  channels: string[];
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

interface DeliveryRow {
  id: string;
  triggerKey: string;
  channelType: string;
  recipient: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  attempts: number;
  lastError: string | null;
}

export function MessagingPage() {
  const { t } = useTranslation(['messaging', 'common']);
  const [tab, setTab] = useState<Tab>('templates');

  return (
    <div className="space-y-4">
      <PageHeader title={t('messaging:page.title')} description={t('messaging:page.subtitle')} />

      <div className="flex gap-2 border-b">
        {(['templates', 'triggers', 'deliveries'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === k
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            data-testid={`messaging-tab-${k}`}
          >
            {t(`messaging:tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'templates' && <TemplatesTab />}
      {tab === 'triggers' && <TriggersTab />}
      {tab === 'deliveries' && <DeliveriesTab />}
    </div>
  );
}

// ---------- Templates ----------

function TemplatesTab() {
  const { t } = useTranslation(['messaging', 'common']);
  const utils = trpc.useUtils();
  const [filterLang, setFilterLang] = useState<string>('');
  const [filterTrigger, setFilterTrigger] = useState<string>('');
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [draft, setDraft] = useState({ subject: '', body: '' });

  const list = trpc.messaging.listTemplates.useQuery({
    language: (filterLang || undefined) as 'tr' | 'ru' | 'tg' | undefined,
    triggerKey: filterTrigger || undefined,
  });
  const items = (list.data as TemplateRow[] | undefined) ?? [];

  const update = trpc.messaging.updateTemplate.useMutation({
    onSuccess: async () => {
      toast.success(t('messaging:templates.saved'));
      setEditing(null);
      await utils.messaging.listTemplates.invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof TRPCClientError ? err.message : t('messaging:errors.unknown')),
  });

  function openEdit(tpl: TemplateRow) {
    setEditing(tpl);
    setDraft({ subject: tpl.subject ?? '', body: tpl.body });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <div>
          <Label className="text-xs">{t('messaging:templates.language')}</Label>
          <select
            value={filterLang}
            onChange={(e) => setFilterLang(e.target.value)}
            className="focus-ring ml-2 rounded-lg border border-field bg-background px-2 py-1 text-sm hover:border-field-hover"
          >
            <option value="">{t('messaging:triggers.all')}</option>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">{t('messaging:templates.triggerKey')}</Label>
          <Input
            value={filterTrigger}
            onChange={(e) => setFilterTrigger(e.target.value)}
            className="ml-2 inline-block w-64"
            placeholder="APPOINTMENT_CONFIRMATION"
          />
        </div>
      </div>

      {list.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('messaging:templates.emptyState')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="w-full text-sm">
            <TableHeader className="bg-muted text-left">
              <TableRow>
                <TableHead className="p-2">{t('messaging:templates.triggerKey')}</TableHead>
                <TableHead className="p-2">{t('messaging:templates.language')}</TableHead>
                <TableHead className="p-2">{t('messaging:templates.channel')}</TableHead>
                <TableHead className="p-2">{t('messaging:templates.subject')}</TableHead>
                <TableHead className="p-2">{t('messaging:templates.body')}</TableHead>
                <TableHead className="p-2 text-right">{t('messaging:templates.edit')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((tpl) => (
                <TableRow key={tpl.id} className="border-t">
                  <TableCell className="p-2 font-mono text-xs">{tpl.triggerKey}</TableCell>
                  <TableCell className="p-2">{tpl.language.toUpperCase()}</TableCell>
                  <TableCell className="p-2">{tpl.channelType}</TableCell>
                  <TableCell className="p-2">{tpl.subject ?? '—'}</TableCell>
                  <TableCell className="max-w-md truncate p-2 text-xs text-muted-foreground">
                    {tpl.body}
                  </TableCell>
                  <TableCell className="p-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(tpl)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(next) => {
          if (next || !editing) return;
          const dirty = draft.subject !== (editing.subject ?? '') || draft.body !== editing.body;
          if (!confirmIfDirty(dirty, t('common:forms.unsavedConfirm'))) return;
          setEditing(null);
        }}
      >
        <DialogContent className="max-w-2xl space-y-3">
          {editing && (
            <>
              <DialogTitle className="text-base">
                {editing.triggerKey} · {editing.language.toUpperCase()} · {editing.channelType}
              </DialogTitle>
              <div className="flex flex-wrap gap-1">
                {editing.variables.map((v) => (
                  <Badge key={v} variant="outline" className="font-mono text-xs">
                    {`{{${v}}}`}
                  </Badge>
                ))}
              </div>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  update.mutate({
                    id: editing.id,
                    subject: draft.subject || null,
                    body: draft.body,
                  });
                }}
              >
                <div>
                  <Label>{t('messaging:templates.subject')}</Label>
                  <Input
                    value={draft.subject}
                    onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{t('messaging:templates.body')}</Label>
                  <textarea
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    rows={6}
                    className="focus-ring w-full rounded-lg border border-field bg-background p-2 text-sm hover:border-field-hover"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                    {t('messaging:templates.cancel')}
                  </Button>
                  <Button type="submit" disabled={update.isPending}>
                    {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('messaging:templates.save')}
                  </Button>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Triggers ----------

function TriggersTab() {
  const { t } = useTranslation(['messaging', 'common']);
  const utils = trpc.useUtils();
  const [filterCat, setFilterCat] = useState<string>('');
  const list = trpc.messaging.listTriggers.useQuery({
    category: (filterCat || undefined) as (typeof CATEGORIES)[number] | undefined,
  });
  const items = (list.data as TriggerRow[] | undefined) ?? [];

  const update = trpc.messaging.updateTriggerConfig.useMutation({
    onSuccess: async () => {
      toast.success(t('messaging:triggers.saved'));
      await utils.messaging.listTriggers.invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof TRPCClientError ? err.message : t('messaging:errors.unknown')),
  });

  function toggleEnabled(tr: TriggerRow, value: boolean) {
    update.mutate({ id: tr.id, isEnabled: value });
  }

  function setQuietHours(tr: TriggerRow, start: number | null, end: number | null) {
    update.mutate({ id: tr.id, quietHoursStart: start, quietHoursEnd: end });
  }

  function toggleChannel(tr: TriggerRow, ch: string, enabled: boolean) {
    const next = enabled ? [...tr.channels, ch] : tr.channels.filter((c) => c !== ch);
    if (next.length === 0) return;
    update.mutate({ id: tr.id, channels: next as (typeof CHANNELS)[number][] });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <div>
          <Label className="text-xs">{t('messaging:triggers.category')}</Label>
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            className="focus-ring ml-2 rounded-lg border border-field bg-background px-2 py-1 text-sm hover:border-field-hover"
          >
            <option value="">{t('messaging:triggers.all')}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`messaging:triggers.category${c.charAt(0)}${c.slice(1).toLowerCase()}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {list.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="w-full text-sm">
            <TableHeader className="bg-muted text-left">
              <TableRow>
                <TableHead className="p-2">{t('messaging:triggers.name')}</TableHead>
                <TableHead className="p-2">{t('messaging:triggers.key')}</TableHead>
                <TableHead className="p-2">{t('messaging:triggers.enabled')}</TableHead>
                <TableHead className="p-2">{t('messaging:triggers.channels')}</TableHead>
                <TableHead className="p-2">{t('messaging:triggers.quietHours')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((tr) => (
                <TableRow key={tr.id} className="border-t">
                  <TableCell className="p-2">
                    {tr.name}
                    {tr.isMandatory && (
                      <Badge
                        variant="critical"
                        className="ml-2"
                        title={t('messaging:triggers.mandatoryHint')}
                      >
                        {t('messaging:triggers.mandatory')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="p-2 font-mono text-xs text-muted-foreground">
                    {tr.key}
                  </TableCell>
                  <TableCell className="p-2">
                    <input
                      type="checkbox"
                      checked={tr.isEnabled}
                      disabled={tr.isMandatory}
                      onChange={(e) => toggleEnabled(tr, e.target.checked)}
                    />
                  </TableCell>
                  <TableCell className="p-2">
                    {CHANNELS.map((ch) => (
                      <label key={ch} className="mr-2 inline-flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={tr.channels.includes(ch)}
                          onChange={(e) => toggleChannel(tr, ch, e.target.checked)}
                        />
                        {ch}
                      </label>
                    ))}
                  </TableCell>
                  <TableCell className="p-2 text-xs">
                    <input
                      key={`start-${tr.id}-${tr.quietHoursStart ?? 'null'}`}
                      type="number"
                      min={0}
                      max={23}
                      defaultValue={tr.quietHoursStart ?? ''}
                      placeholder="0-23"
                      className="w-14 rounded border px-1"
                      onBlur={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        if (v !== tr.quietHoursStart) {
                          setQuietHours(tr, v, tr.quietHoursEnd);
                        }
                      }}
                    />
                    {' → '}
                    <input
                      key={`end-${tr.id}-${tr.quietHoursEnd ?? 'null'}`}
                      type="number"
                      min={0}
                      max={23}
                      defaultValue={tr.quietHoursEnd ?? ''}
                      placeholder="0-23"
                      className="w-14 rounded border px-1"
                      onBlur={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        if (v !== tr.quietHoursEnd) {
                          setQuietHours(tr, tr.quietHoursStart, v);
                        }
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ---------- Deliveries ----------

function DeliveriesTab() {
  const { t } = useTranslation(['messaging', 'common']);
  const { locale } = useLocale();
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterTrigger, setFilterTrigger] = useState<string>('');
  const [filterRecipient, setFilterRecipient] = useState<string>('');

  const list = trpc.messaging.listDeliveries.useQuery({
    status: (filterStatus || undefined) as (typeof STATUSES)[number] | undefined,
    triggerKey: filterTrigger || undefined,
    recipient: filterRecipient || undefined,
    page: 1,
    pageSize: 100,
  });
  const data = list.data as { items: DeliveryRow[]; total: number } | undefined;
  const items = data?.items ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <div>
          <Label className="text-xs">{t('messaging:deliveries.filterStatus')}</Label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="focus-ring ml-2 rounded-lg border border-field bg-background px-2 py-1 text-sm hover:border-field-hover"
          >
            <option value="">{t('messaging:deliveries.all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">{t('messaging:deliveries.filterTrigger')}</Label>
          <Input
            value={filterTrigger}
            onChange={(e) => setFilterTrigger(e.target.value)}
            className="ml-2 inline-block w-56"
          />
        </div>
        <div>
          <Label className="text-xs">{t('messaging:deliveries.filterRecipient')}</Label>
          <Input
            value={filterRecipient}
            onChange={(e) => setFilterRecipient(e.target.value)}
            className="ml-2 inline-block w-48"
            placeholder="+992..."
          />
        </div>
      </div>

      {list.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('messaging:deliveries.emptyState')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="w-full text-sm">
            <TableHeader className="bg-muted text-left">
              <TableRow>
                <TableHead className="p-2">{t('messaging:deliveries.status')}</TableHead>
                <TableHead className="p-2">{t('messaging:deliveries.trigger')}</TableHead>
                <TableHead className="p-2">{t('messaging:deliveries.recipient')}</TableHead>
                <TableHead className="p-2">{t('messaging:deliveries.scheduledAt')}</TableHead>
                <TableHead className="p-2">{t('messaging:deliveries.sentAt')}</TableHead>
                <TableHead className="p-2">{t('messaging:deliveries.attempts')}</TableHead>
                <TableHead className="p-2">{t('messaging:deliveries.lastError')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.id} className="border-t">
                  <TableCell className="p-2">
                    <Badge
                      variant={
                        d.status === 'DELIVERED' || d.status === 'SENT'
                          ? 'success'
                          : d.status === 'PENDING'
                            ? 'warning'
                            : d.status === 'FAILED'
                              ? 'critical'
                              : 'outline'
                      }
                    >
                      {d.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="p-2 font-mono text-xs">{d.triggerKey}</TableCell>
                  <TableCell className="p-2">{d.recipient}</TableCell>
                  <TableCell className="p-2 text-xs">
                    {formatDateTime(d.scheduledAt, locale)}
                  </TableCell>
                  <TableCell className="p-2 text-xs">
                    {d.sentAt ? formatDateTime(d.sentAt, locale) : '—'}
                  </TableCell>
                  <TableCell className="p-2">{d.attempts}</TableCell>
                  <TableCell className="max-w-xs truncate p-2 text-xs text-critical-foreground">
                    {d.lastError ?? ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
