import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Undo2, Info } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { trpc } from '../lib/trpc';
import { mapTrpcError } from '../lib/trpc-error';

// v0.4 #557 — Eczane İade. Satış seç → kalem bazlı iade → stok+kasa düzelt (#552).

interface SaleRow {
  id: string;
  saleNo: string;
  soldAt: string;
  totalAmount: string | number;
  currency: string;
}

export function PharmacyReturnsPage() {
  const { t } = useTranslation(['common']);
  const utils = trpc.useUtils();
  const [returnFor, setReturnFor] = useState<SaleRow | null>(null);

  const sales = trpc.pharmacyRetail.listSales.useQuery({});
  const returns = trpc.pharmacyRetail.listReturns.useQuery({});
  const saleRows = (sales.data ?? []) as unknown as SaleRow[];
  const returnRows = (returns.data ?? []) as unknown as {
    id: string;
    returnNo: string;
    totalAmount: string | number;
    currency: string;
    createdAt: string;
  }[];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.pharmacyReturns', { defaultValue: 'İade' })}
        description={t('phReturn.description', {
          defaultValue: 'Satış seç, kalem iade et; stok ve kasa düzeltilir.',
        })}
      />

      {/* R9 #731 — iade uyum bilgisi: ayrı finans onayı yok; stok+kasaya anında
          yansır, gün sonu kasa kapanışında finans mutabakatında görünür. */}
      <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          {t('phReturn.complianceBanner', {
            defaultValue:
              'İade stok ve kasaya anında yansır; gün sonu kasa kapanışında finans mutabakatında görünür. Ayrı finans onayı gerekmez.',
          })}
        </span>
      </div>

      <section className="rounded-lg border bg-card">
        <header className="border-b px-4 py-3 text-sm font-semibold">
          {t('phReturn.recentSales', { defaultValue: 'Son Satışlar' })}
        </header>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('phReturn.colNo', { defaultValue: 'Satış No' })}</TableHead>
              <TableHead>{t('phReturn.colDate', { defaultValue: 'Tarih' })}</TableHead>
              <TableHead className="text-right">
                {t('phReturn.colTotal', { defaultValue: 'Tutar' })}
              </TableHead>
              <TableHead className="text-right">
                {t('phReturn.colActions', { defaultValue: 'İşlem' })}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {saleRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  {t('phReturn.noSales', { defaultValue: 'Satış yok.' })}
                </TableCell>
              </TableRow>
            )}
            {saleRows.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.saleNo}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(s.soldAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {Number(s.totalAmount).toFixed(2)} {s.currency}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setReturnFor(s)}>
                    <Undo2 className="mr-1 h-4 w-4" />
                    {t('phReturn.return', { defaultValue: 'İade' })}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="rounded-lg border bg-card">
        <header className="border-b px-4 py-3 text-sm font-semibold">
          {t('phReturn.history', { defaultValue: 'İade Geçmişi' })}
        </header>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('phReturn.colReturnNo', { defaultValue: 'İade No' })}</TableHead>
              <TableHead>{t('phReturn.colDate', { defaultValue: 'Tarih' })}</TableHead>
              <TableHead className="text-right">
                {t('phReturn.colTotal', { defaultValue: 'Tutar' })}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {returnRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                  {t('phReturn.noReturns', { defaultValue: 'İade yok.' })}
                </TableCell>
              </TableRow>
            )}
            {returnRows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.returnNo}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {Number(r.totalAmount).toFixed(2)} {r.currency}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {returnFor && (
        <ReturnDialog
          sale={returnFor}
          onClose={() => setReturnFor(null)}
          onSaved={() => {
            void utils.pharmacyRetail.listReturns.invalidate();
            void utils.pharmacyRetail.listSales.invalidate();
            setReturnFor(null);
          }}
        />
      )}
    </div>
  );
}

function ReturnDialog({
  sale,
  onClose,
  onSaved,
}: {
  sale: SaleRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['common']);
  const detail = trpc.pharmacyRetail.saleById.useQuery({ id: sale.id });
  const items = (detail.data?.items ?? []) as unknown as {
    id: string;
    itemName: string;
    quantity: number;
    unitPrice: string | number;
  }[];
  const [qty, setQty] = useState<Record<string, string>>({});
  const create = trpc.pharmacyRetail.createReturn.useMutation({
    onSuccess: () => {
      toast.success(t('phReturn.done', { defaultValue: 'İade yapıldı' }));
      onSaved();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  const submit = () => {
    const lines = items
      .map((it) => ({ saleItemId: it.id, quantity: parseInt(qty[it.id] ?? '0', 10) || 0 }))
      .filter((l) => l.quantity > 0);
    if (lines.length === 0) {
      toast.error(t('phReturn.selectItems', { defaultValue: 'İade adedi girin' }));
      return;
    }
    create.mutate({ saleId: sale.id, items: lines });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>
          {t('phReturn.titleNo', { no: sale.saleNo, defaultValue: `İade — ${sale.saleNo}` })}
        </DialogTitle>
        <DialogDescription>
          {t('phReturn.dialogHint', {
            defaultValue: 'İade edilecek adedi girin (satıştan fazla olamaz).',
          })}
        </DialogDescription>
        <div className="mt-2 space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-sm font-medium">{it.itemName}</div>
                <div className="text-xs text-muted-foreground">
                  {t('phReturn.sold', { defaultValue: 'satılan' })}: {it.quantity} ·{' '}
                  {Number(it.unitPrice).toFixed(2)} ₸
                </div>
              </div>
              <div className="w-24">
                <Label className="sr-only">{it.itemName}</Label>
                <Input
                  type="number"
                  min={0}
                  max={it.quantity}
                  value={qty[it.id] ?? ''}
                  placeholder="0"
                  onChange={(e) => setQty((prev) => ({ ...prev, [it.id]: e.target.value }))}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button disabled={create.isPending || items.length === 0} onClick={submit}>
            {t('phReturn.return', { defaultValue: 'İade' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
