import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { useMemo, useState } from 'react';
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { DateField } from '../components/ui/date-field';
import { Label } from '../components/ui/label';
import { confirmIfDirty } from '../hooks/useUnsavedWarning';
import {
  COMMISSION_ENTRY_STATUSES,
  COMMISSION_RULE_TYPES,
  COMMISSION_SOURCE_TYPES,
  PAYMENT_METHODS,
  SUPPORTED_CURRENCIES,
  formatCurrency,
  type CommissionEntryStatus,
  type CommissionRuleType,
  type CommissionSourceType,
  type Currency,
  type PaymentMethod,
} from '../lib/commission.constants';
import { trpc } from '../lib/trpc';
import { useLocale } from '../providers/LocaleProvider';
import { localeToIntl } from '../lib/i18n-format';

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// AppRouter type artık 20+ router'ı topluyor; tRPC v11 mutation inference'ı
// `TS2589 (Type instantiation is excessively deep)` ile patlıyor. Bu modül
// için trpc.commission'ı gevşek tipte alıyoruz; backend Zod validasyonu +
// i18n hata mesajları run-time tip emniyetini sağlıyor. v0.3'te AppRouter
// sub-router'lara bölündüğünde kaldırılır (issue: type-debt).
type LooseMutation = {
  useMutation: (opts: {
    onSuccess?: (data: unknown) => void;
    onError?: (err: unknown) => void;
  }) => { mutate: (input: unknown) => void; isPending: boolean };
};
const looseCommission = trpc.commission as unknown as {
  approve: LooseMutation;
  reject: LooseMutation;
  markPaid: LooseMutation;
  softDeleteRule: LooseMutation;
  createRule: LooseMutation;
  calculate: LooseMutation;
};

interface EntryRow {
  id: string;
  doctorId: string;
  sourceType: CommissionSourceType;
  sourceId: string;
  amount: string;
  baseAmount: string | null;
  currency: string;
  status: CommissionEntryStatus;
  rejectionReason: string | null;
  paidAt: string | null;
  paidMethod: string | null;
  calculatedAt: string;
  doctor: { id: string; name: string; specialty: string };
  rule: { id: string; type: CommissionRuleType; value: string; currency: string } | null;
  reviewedBy: { id: string; name: string } | null;
}

interface RuleRow {
  id: string;
  doctorId: string | null;
  type: CommissionRuleType;
  value: string;
  currency: string;
  applicableSurgeryTypes: string[];
  applicableProcedureTypes: string[];
  priority: number;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  notes: string | null;
  doctor: { id: string; name: string } | null;
}

export function CommissionPage() {
  const tHook = useTranslation(['commission', 'common']);
  const t: TFn = tHook.t;
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale);
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<'entries' | 'rules' | 'monthly'>('entries');
  const [statusFilter, setStatusFilter] = useState<CommissionEntryStatus | ''>('');
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const today = new Date();
  const [summaryMonth, setSummaryMonth] = useState({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  });

  const handleError = (err: unknown, fallback: string): void => {
    const msg = err instanceof TRPCClientError ? err.message : fallback;
    toast.error(msg);
  };

  const entries = trpc.commission.listEntries.useQuery({
    status: (statusFilter || undefined) as CommissionEntryStatus | undefined,
    limit: 200,
  });
  const rules = trpc.commission.listRules.useQuery({ includeInactive: true });
  const summary = trpc.commission.monthlySummary.useQuery(summaryMonth);

  const entryRows = (entries.data ?? []) as unknown as EntryRow[];
  const ruleRows = (rules.data ?? []) as unknown as RuleRow[];

  const approve = looseCommission.approve.useMutation({
    onSuccess: () => {
      toast.success(t('commission:toast.approved'));
      void utils.commission.listEntries.invalidate();
    },
    onError: (e) => handleError(e, t('commission:errors.unknown')),
  });
  const reject = looseCommission.reject.useMutation({
    onSuccess: () => {
      toast.success(t('commission:toast.rejected'));
      void utils.commission.listEntries.invalidate();
    },
    onError: (e) => handleError(e, t('commission:errors.unknown')),
  });
  const markPaid = looseCommission.markPaid.useMutation({
    onSuccess: () => {
      toast.success(t('commission:toast.paid'));
      void utils.commission.listEntries.invalidate();
    },
    onError: (e) => handleError(e, t('commission:errors.unknown')),
  });
  const softDeleteRule = looseCommission.softDeleteRule.useMutation({
    onSuccess: () => {
      toast.success(t('commission:toast.ruleDeleted'));
      void utils.commission.listRules.invalidate();
    },
    onError: (e) => handleError(e, t('commission:errors.unknown')),
  });

  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(dateLocale);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(dateLocale);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('commission:title')}
        description={t('commission:description')}
        actions={
          <>
            <Button variant="outline" onClick={() => setRuleFormOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('commission:actions.newRule')}
            </Button>
            <Button onClick={() => setCalcOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('commission:actions.calculate')}
            </Button>
          </>
        }
      />

      <div className="flex gap-2 border-b">
        {(['entries', 'rules', 'monthly'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === k
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            data-testid={`commission-tab-${k}`}
          >
            {t(`commission:tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'entries' && (
        <section className="space-y-3" data-testid="commission-entries-tab">
          <div className="flex items-center gap-2">
            <Label htmlFor="comm-status" className="m-0">
              {t('commission:filters.status')}
            </Label>
            <select
              id="comm-status"
              className={`${SELECT_CLASS} max-w-xs`}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CommissionEntryStatus | '')}
            >
              <option value="">{t('commission:filters.all')}</option>
              {COMMISSION_ENTRY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`commission:status.${s}`)}
                </option>
              ))}
            </select>
          </div>

          {entries.isLoading ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : entryRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('commission:emptyEntries')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-background">
              <Table className="w-full text-sm">
                <TableHeader className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <TableRow>
                    <TableHead className="px-3 py-2">{t('commission:cols.calculatedAt')}</TableHead>
                    <TableHead className="px-3 py-2">{t('commission:cols.doctor')}</TableHead>
                    <TableHead className="px-3 py-2">{t('commission:cols.source')}</TableHead>
                    <TableHead className="px-3 py-2 text-right">
                      {t('commission:cols.amount')}
                    </TableHead>
                    <TableHead className="px-3 py-2">{t('commission:cols.status')}</TableHead>
                    <TableHead className="px-3 py-2 text-right">
                      {t('commission:cols.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody data-testid="commission-entry-rows">
                  {entryRows.map((e) => (
                    <TableRow key={e.id} className="border-t align-top">
                      <TableCell className="whitespace-nowrap px-3 py-2 text-xs">
                        {fmtDateTime(e.calculatedAt)}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <div>{e.doctor.name}</div>
                        <div className="text-xs text-muted-foreground">{e.doctor.specialty}</div>
                      </TableCell>
                      <TableCell className="px-3 py-2 text-xs">
                        {t(`commission:source.${e.sourceType}`)}
                        <div className="font-mono text-xs text-muted-foreground">
                          {e.sourceId.slice(0, 8)}…
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                        {formatCurrency(e.amount, e.currency, dateLocale)}
                        {e.baseAmount && (
                          <div className="text-xs tabular-nums text-muted-foreground">
                            {t('commission:cols.basePrefix')}{' '}
                            {formatCurrency(e.baseAmount, e.currency, dateLocale)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <StatusBadge status={e.status} t={t} />
                        {e.rejectionReason && (
                          <div className="mt-1 text-xs text-warning-foreground">
                            {e.rejectionReason}
                          </div>
                        )}
                        {e.paidMethod && (
                          <div className="mt-1 text-xs text-success-foreground">
                            {t(`commission:paymentMethod.${e.paidMethod as PaymentMethod}`, {
                              defaultValue: e.paidMethod,
                            })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2 text-right">
                        <EntryActions
                          entry={e}
                          onApprove={() => approve.mutate({ id: e.id })}
                          onReject={(reason) =>
                            reject.mutate({ id: e.id, rejectionReason: reason })
                          }
                          onPay={(method) => markPaid.mutate({ id: e.id, paidMethod: method })}
                          isPending={approve.isPending || reject.isPending || markPaid.isPending}
                          t={t}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {tab === 'rules' && (
        <section className="space-y-3" data-testid="commission-rules-tab">
          {rules.isLoading ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : ruleRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('commission:emptyRules')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-background">
              <Table className="w-full text-sm">
                <TableHeader className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <TableRow>
                    <TableHead className="px-3 py-2">{t('commission:cols.scope')}</TableHead>
                    <TableHead className="px-3 py-2">{t('commission:cols.type')}</TableHead>
                    <TableHead className="px-3 py-2 text-right">
                      {t('commission:cols.value')}
                    </TableHead>
                    <TableHead className="px-3 py-2">{t('commission:cols.validity')}</TableHead>
                    <TableHead className="px-3 py-2 text-right">
                      {t('commission:cols.priority')}
                    </TableHead>
                    <TableHead className="px-3 py-2 text-right">
                      {t('commission:cols.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ruleRows.map((r) => (
                    <TableRow key={r.id} className="border-t align-top">
                      <TableCell className="px-3 py-2">
                        {r.doctor ? r.doctor.name : t('commission:scope.allDoctors')}
                        {!r.isActive && (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                            {t('commission:inactive')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        {t(`commission:ruleType.${r.type}`)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                        {r.type === 'percentage'
                          ? `${r.value} %`
                          : formatCurrency(r.value, r.currency, dateLocale)}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-xs">
                        {fmtDate(r.validFrom)}
                        {r.validTo ? ` → ${fmtDate(r.validTo)}` : ` → ${t('commission:openEnded')}`}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right">{r.priority}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={softDeleteRule.isPending}
                          onClick={() => softDeleteRule.mutate({ id: r.id })}
                          aria-label={t('common:actions.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {tab === 'monthly' && (
        <MonthlySummary
          summaryMonth={summaryMonth}
          onMonthChange={setSummaryMonth}
          data={summary.data}
          isLoading={summary.isLoading}
          t={t}
          dateLocale={dateLocale}
        />
      )}

      {ruleFormOpen && (
        <RuleForm
          onClose={() => setRuleFormOpen(false)}
          onSaved={() => {
            setRuleFormOpen(false);
            void utils.commission.listRules.invalidate();
            toast.success(t('commission:toast.ruleCreated'));
          }}
          handleError={handleError}
          t={t}
        />
      )}

      {calcOpen && (
        <CalculateForm
          onClose={() => setCalcOpen(false)}
          onSaved={() => {
            setCalcOpen(false);
            void utils.commission.listEntries.invalidate();
            toast.success(t('commission:toast.calculated'));
          }}
          handleError={handleError}
          t={t}
        />
      )}
    </div>
  );
}

type TFn = (key: string, options?: Record<string, unknown>) => string;

function StatusBadge({ status, t }: { status: CommissionEntryStatus; t: TFn }) {
  const variant: Record<CommissionEntryStatus, 'warning' | 'info' | 'success' | 'neutral'> = {
    pending: 'warning',
    approved: 'info',
    paid: 'success',
    cancelled: 'neutral',
  };
  return <Badge variant={variant[status]}>{t(`commission:status.${status}`)}</Badge>;
}

function EntryActions({
  entry,
  onApprove,
  onReject,
  onPay,
  isPending,
  t,
}: {
  entry: EntryRow;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onPay: (method: PaymentMethod) => void;
  isPending: boolean;
  t: TFn;
}) {
  const [askReject, setAskReject] = useState(false);
  const [reason, setReason] = useState('');
  const [askPay, setAskPay] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');

  if (entry.status === 'pending' && !askReject) {
    return (
      <div className="flex justify-end gap-1">
        <Button size="sm" disabled={isPending} onClick={onApprove}>
          <Check className="mr-1 h-3.5 w-3.5" />
          {t('commission:actions.approve')}
        </Button>
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => setAskReject(true)}>
          <X className="mr-1 h-3.5 w-3.5" />
          {t('commission:actions.reject')}
        </Button>
      </div>
    );
  }
  if (askReject) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('commission:actions.rejectionReason')}
          className="max-w-xs text-xs"
        />
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending || !reason.trim()}
            onClick={() => {
              onReject(reason.trim());
              setAskReject(false);
              setReason('');
            }}
          >
            {t('commission:actions.confirmReject')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAskReject(false)}>
            {t('common:actions.cancel')}
          </Button>
        </div>
      </div>
    );
  }
  if (entry.status === 'approved' && !askPay) {
    return (
      <Button size="sm" disabled={isPending} onClick={() => setAskPay(true)}>
        {t('commission:actions.markPaid')}
      </Button>
    );
  }
  if (askPay) {
    return (
      <div className="flex flex-col items-end gap-1">
        <select
          className={`${SELECT_CLASS} max-w-xs`}
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`commission:paymentMethod.${m}`)}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => {
              onPay(method);
              setAskPay(false);
            }}
          >
            {t('commission:actions.confirmPaid')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAskPay(false)}>
            {t('common:actions.cancel')}
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

interface MonthlyData {
  period: { year: number; month: number };
  doctors: Array<{
    doctor: { id: string; name: string; specialty: string };
    totals: Record<string, { pending: number; approved: number; paid: number; cancelled: number }>;
  }>;
}

function MonthlySummary({
  summaryMonth,
  onMonthChange,
  data,
  isLoading,
  t,
  dateLocale,
}: {
  summaryMonth: { year: number; month: number };
  onMonthChange: (m: { year: number; month: number }) => void;
  data: unknown;
  isLoading: boolean;
  t: TFn;
  dateLocale: string;
}) {
  const summary = data as MonthlyData | undefined;
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return [now - 1, now, now + 1];
  }, []);

  return (
    <section className="space-y-3" data-testid="commission-monthly-tab">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="comm-year" className="m-0">
          {t('commission:monthly.year')}
        </Label>
        <select
          id="comm-year"
          className={`${SELECT_CLASS} max-w-[6rem]`}
          value={summaryMonth.year}
          onChange={(e) => onMonthChange({ ...summaryMonth, year: Number(e.target.value) })}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <Label htmlFor="comm-month" className="m-0">
          {t('commission:monthly.month')}
        </Label>
        <select
          id="comm-month"
          className={`${SELECT_CLASS} max-w-[6rem]`}
          value={summaryMonth.month}
          onChange={(e) => onMonthChange({ ...summaryMonth, month: Number(e.target.value) })}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, '0')}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex h-24 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !summary || summary.doctors.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('commission:monthly.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <Table className="w-full text-sm">
            <TableHeader className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <TableRow>
                <TableHead className="px-3 py-2">{t('commission:cols.doctor')}</TableHead>
                <TableHead className="px-3 py-2">{t('commission:cols.currency')}</TableHead>
                <TableHead className="px-3 py-2 text-right">
                  {t('commission:status.pending')}
                </TableHead>
                <TableHead className="px-3 py-2 text-right">
                  {t('commission:status.approved')}
                </TableHead>
                <TableHead className="px-3 py-2 text-right">
                  {t('commission:status.paid')}
                </TableHead>
                <TableHead className="px-3 py-2 text-right">
                  {t('commission:status.cancelled')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.doctors.flatMap((d) =>
                Object.entries(d.totals).map(([currency, totals], idx) => (
                  <TableRow key={`${d.doctor.id}-${currency}`} className="border-t">
                    {idx === 0 ? (
                      <TableCell className="px-3 py-2" rowSpan={Object.keys(d.totals).length}>
                        <div>{d.doctor.name}</div>
                        <div className="text-xs text-muted-foreground">{d.doctor.specialty}</div>
                      </TableCell>
                    ) : null}
                    <TableCell className="px-3 py-2 text-xs font-mono">{currency}</TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(totals.pending, currency, dateLocale)}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(totals.approved, currency, dateLocale)}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatCurrency(totals.paid, currency, dateLocale)}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatCurrency(totals.cancelled, currency, dateLocale)}
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function RuleForm({
  onClose,
  onSaved,
  handleError,
  t,
}: {
  onClose: () => void;
  onSaved: () => void;
  handleError: (err: unknown, fallback: string) => void;
  t: TFn;
}) {
  const doctorList = trpc.doctor.list.useQuery({ page: 1, pageSize: 200, isActive: true });
  const [doctorId, setDoctorId] = useState<string>('');
  const [type, setType] = useState<CommissionRuleType>('per_surgery');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [priority, setPriority] = useState('0');
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [validTo, setValidTo] = useState('');
  const [notes, setNotes] = useState('');

  const create = looseCommission.createRule.useMutation({
    onSuccess: onSaved,
    onError: (e) => handleError(e, t('commission:errors.unknown')),
  });

  const dirty =
    doctorId !== '' ||
    type !== 'per_surgery' ||
    value !== '' ||
    currency !== 'USD' ||
    priority !== '0' ||
    validTo !== '' ||
    notes !== '';
  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (!confirmIfDirty(dirty, t('common:forms.unsavedConfirm'))) return;
    onClose();
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({
      doctorId: doctorId || null,
      type,
      value,
      currency,
      applicableSurgeryTypes: [],
      applicableProcedureTypes: [],
      priority: Number(priority) || 0,
      validFrom,
      validTo: validTo || null,
      notes: notes.trim() || null,
    });
  };

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit} className="space-y-3" data-testid="commission-rule-form">
          <DialogTitle className="text-lg">{t('commission:ruleForm.title')}</DialogTitle>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rf-doctor">{t('commission:ruleForm.doctor')}</Label>
              <select
                id="rf-doctor"
                className={SELECT_CLASS}
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
              >
                <option value="">{t('commission:scope.allDoctors')}</option>
                {(doctorList.data?.items ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — {d.specialty}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-type">{t('commission:ruleForm.type')}</Label>
              <select
                id="rf-type"
                className={SELECT_CLASS}
                value={type}
                onChange={(e) => setType(e.target.value as CommissionRuleType)}
              >
                {COMMISSION_RULE_TYPES.map((rt) => (
                  <option key={rt} value={rt}>
                    {t(`commission:ruleType.${rt}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-value">
                {type === 'percentage'
                  ? t('commission:ruleForm.percentValue')
                  : t('commission:ruleForm.amountValue')}
              </Label>
              <Input
                id="rf-value"
                type="number"
                step="0.01"
                min="0"
                max={type === 'percentage' ? '100' : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-currency">{t('commission:ruleForm.currency')}</Label>
              <select
                id="rf-currency"
                className={SELECT_CLASS}
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-priority">{t('commission:ruleForm.priority')}</Label>
              <Input
                id="rf-priority"
                type="number"
                min="0"
                max="1000"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-from">{t('commission:ruleForm.validFrom')}</Label>
              <DateField id="rf-from" value={validFrom} onChange={setValidFrom} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-to">{t('commission:ruleForm.validTo')}</Label>
              <DateField id="rf-to" value={validTo} onChange={setValidTo} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rf-notes">{t('commission:ruleForm.notes')}</Label>
              <textarea
                id="rf-notes"
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending} data-testid="rule-submit">
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('common:actions.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CalculateForm({
  onClose,
  onSaved,
  handleError,
  t,
}: {
  onClose: () => void;
  onSaved: () => void;
  handleError: (err: unknown, fallback: string) => void;
  t: TFn;
}) {
  const [sourceType, setSourceType] = useState<CommissionSourceType>('surgery');
  const [sourceId, setSourceId] = useState('');
  const [baseAmount, setBaseAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');

  const calc = looseCommission.calculate.useMutation({
    onSuccess: onSaved,
    onError: (e) => handleError(e, t('commission:errors.unknown')),
  });

  const dirty =
    sourceType !== 'surgery' || sourceId !== '' || baseAmount !== '' || currency !== 'USD';
  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (!confirmIfDirty(dirty, t('common:forms.unsavedConfirm'))) return;
    onClose();
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    calc.mutate({
      sourceType,
      sourceId: sourceId.trim(),
      baseAmount: baseAmount.trim() || undefined,
      currency,
    });
  };

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-3" data-testid="commission-calc-form">
          <DialogTitle className="text-lg">{t('commission:calcForm.title')}</DialogTitle>
          <p className="text-xs text-muted-foreground">{t('commission:calcForm.hint')}</p>

          <div className="space-y-1.5">
            <Label htmlFor="cf-type">{t('commission:calcForm.sourceType')}</Label>
            <select
              id="cf-type"
              className={SELECT_CLASS}
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as CommissionSourceType)}
            >
              {COMMISSION_SOURCE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t(`commission:source.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cf-id">{t('commission:calcForm.sourceId')}</Label>
            <Input
              id="cf-id"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              placeholder="uuid"
              required
              className="font-mono text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cf-base">{t('commission:calcForm.baseAmount')}</Label>
              <Input
                id="cf-base"
                type="number"
                step="0.01"
                min="0"
                value={baseAmount}
                onChange={(e) => setBaseAmount(e.target.value)}
                placeholder={t('commission:calcForm.baseAmountHint')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-currency">{t('commission:ruleForm.currency')}</Label>
              <select
                id="cf-currency"
                className={SELECT_CLASS}
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={calc.isPending} data-testid="calc-submit">
              {calc.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('commission:actions.calculate')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
