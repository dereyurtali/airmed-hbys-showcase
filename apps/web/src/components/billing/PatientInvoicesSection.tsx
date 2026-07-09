import { localeToIntl, getDateTimeFormat } from '../../lib/i18n-format';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { InvoiceCreateDialog } from './InvoiceCreateDialog';
import {
  INVOICE_STATUS_COLORS,
  formatMoney,
  type InvoiceStatus,
} from '../../lib/billing.constants';
import { billingApi, type InvoiceRow } from '../../lib/billing.trpc';
import { usePermission } from '../../hooks/usePermission';
import { useLocale } from '../../providers/LocaleProvider';

// S11f — Hasta detayında "Faturalar" bölümü.
// Görünürlük: view:patient.invoices (doktor + admin + resep)
// Açık bakiye: view:patient.openBalance (front desk + admin)
// "Yeni fatura": action:invoice.create

interface Props {
  patientId: string;
}

export function PatientInvoicesSection({ patientId }: Props) {
  const { t } = useTranslation(['billing', 'common']);
  const { locale } = useLocale();

  const canCreate = usePermission('action:invoice.create');
  const canSeeBalance = usePermission('view:patient.openBalance');

  const [createOpen, setCreateOpen] = useState(false);

  const list = billingApi.listInvoicesByPatient.useQuery({ patientId });
  const balance = billingApi.openBalance.useQuery({ patientId });

  const dateFmt = getDateTimeFormat(localeToIntl(locale) ?? 'tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('billing:invoice.title')}</h2>
          {canSeeBalance && balance.data && (
            <p className="text-sm">
              <span className="text-muted-foreground">{t('billing:common.openBalance')}: </span>
              <span
                className={`font-semibold tabular-nums ${
                  parseFloat(balance.data.openTjsEquivalent) > 0
                    ? 'text-warning-foreground'
                    : 'text-success-foreground'
                }`}
              >
                {formatMoney(balance.data.openTjsEquivalent, 'TJS', localeToIntl(locale))}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                ({balance.data.invoiceCount} açık fatura)
              </span>
            </p>
          )}
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('billing:invoice.new')}
          </Button>
        )}
      </header>

      {list.isLoading && (
        <p className="text-sm text-muted-foreground">{t('common:states.loading')}</p>
      )}

      {list.data && list.data.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border p-6 text-center text-sm text-muted-foreground">
          <Receipt className="h-8 w-8 opacity-40" />
          {t('billing:invoice.noInvoices')}
        </div>
      )}

      {list.data && list.data.length > 0 && (
        <ul className="space-y-2">
          {list.data.map((inv: InvoiceRow) => (
            <li key={inv.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <Link
                    to={`/billing/${inv.id}`}
                    className="font-mono text-sm text-primary hover:underline"
                  >
                    {inv.invoiceNumber}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {dateFmt.format(new Date(inv.createdAt))}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">
                    {formatMoney(inv.total, inv.currency, localeToIntl(locale))}
                  </span>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      INVOICE_STATUS_COLORS[inv.status as InvoiceStatus]
                    }`}
                  >
                    {t(`billing:invoice.statusLabel.${inv.status}`)}
                  </span>
                </div>
              </div>
              {inv.items.length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {inv.items.map((it) => it.description).join(' · ')}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {createOpen && (
        <InvoiceCreateDialog
          patientId={patientId}
          onClose={() => setCreateOpen(false)}
          onCreated={(inv) => {
            toast.success(t('billing:invoice.createdToast', { number: inv.invoiceNumber }));
            void list.refetch();
            void balance.refetch();
            setCreateOpen(false);
          }}
        />
      )}
    </section>
  );
}
