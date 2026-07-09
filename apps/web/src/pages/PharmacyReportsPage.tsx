import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { trpc } from '../lib/trpc';

// v0.4 #558 — Eczane Satış Raporları. Tarih aralığı → ciro/kâr/iade + en çok satan.

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(offsetDays === 0 ? 23 : 0, offsetDays === 0 ? 59 : 0, 0, 0);
  return d.toISOString();
}

interface Report {
  saleCount: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  refundTotal: number;
  refundCount: number;
  netRevenue: number;
  topProducts: { name: string; qty: number; revenue: number }[];
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function PharmacyReportsPage() {
  const { t } = useTranslation(['common']);
  const [from, setFrom] = useState(isoDay(-7).slice(0, 10));
  const [to, setTo] = useState(isoDay(0).slice(0, 10));

  const query = trpc.pharmacyRetail.salesReport.useQuery({
    from: new Date(`${from}T00:00:00`).toISOString(),
    to: new Date(`${to}T23:59:59`).toISOString(),
  });
  const r = query.data as Report | undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.pharmacyReports', { defaultValue: 'Satış Raporları' })}
        description={t('phReport.description', {
          defaultValue: 'Gün/aralık satış, kârlılık, iade.',
        })}
      />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>{t('phReport.from', { defaultValue: 'Başlangıç' })}</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>{t('phReport.to', { defaultValue: 'Bitiş' })}</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label={t('phReport.saleCount', { defaultValue: 'Satış adedi' })}
              value={String(r.saleCount)}
            />
            <Kpi
              label={t('phReport.revenue', { defaultValue: 'Ciro' })}
              value={`${r.revenue.toFixed(2)} TJS`}
            />
            <Kpi
              label={t('phReport.profit', { defaultValue: 'Brüt kâr' })}
              value={`${r.grossProfit.toFixed(2)} TJS`}
            />
            <Kpi
              label={t('phReport.refunds', { defaultValue: 'İade' })}
              value={`${r.refundTotal.toFixed(2)} TJS`}
            />
          </div>

          <section className="rounded-lg border bg-card">
            <header className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
              <BarChart3 className="h-4 w-4" />
              {t('phReport.topProducts', { defaultValue: 'En Çok Satanlar' })}
            </header>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('phReport.colProduct', { defaultValue: 'Ürün' })}</TableHead>
                  <TableHead className="text-right">
                    {t('phReport.colQty', { defaultValue: 'Adet' })}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('phReport.colRevenue', { defaultValue: 'Ciro' })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.topProducts.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      {t('phReport.empty', { defaultValue: 'Bu aralıkta satış yok.' })}
                    </TableCell>
                  </TableRow>
                )}
                {r.topProducts.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.revenue.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </>
      )}
    </div>
  );
}
