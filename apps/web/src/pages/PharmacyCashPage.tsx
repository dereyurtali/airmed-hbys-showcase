import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Banknote, CheckCircle2, Lock, Send } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
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
import { usePermission } from '../hooks/usePermission';

// v0.4 #556 — Eczane Kasası (gün sonu) + finansa teslim. Mantık #552.

type CashStatus = 'open' | 'closed' | 'handed_to_finance';
const STATUS_VARIANT: Record<CashStatus, 'default' | 'secondary' | 'outline'> = {
  open: 'default',
  closed: 'secondary',
  handed_to_finance: 'outline',
};

interface Closure {
  id: string;
  businessDate: string;
  status: CashStatus;
  openingFloat: string | number;
  salesTotal: string | number;
  refundTotal: string | number;
  expectedAmount: string | number;
  countedAmount: string | number | null;
  variance: string | number | null;
  reconciledAt: string | null;
}

export function PharmacyCashPage() {
  const { t } = useTranslation(['common']);
  const utils = trpc.useUtils();
  const [opening, setOpening] = useState('0');
  const [closeTarget, setCloseTarget] = useState<Closure | null>(null);

  const current = trpc.pharmacyRetail.currentCash.useQuery();
  const history = trpc.pharmacyRetail.listCash.useQuery({});
  const cur = current.data as Closure | null | undefined;
  const rows = (history.data ?? []) as unknown as Closure[];

  const invalidate = () => {
    void utils.pharmacyRetail.currentCash.invalidate();
    void utils.pharmacyRetail.listCash.invalidate();
  };
  const open = trpc.pharmacyRetail.openCash.useMutation({
    onSuccess: () => {
      toast.success(t('cash.opened', { defaultValue: 'Kasa açıldı' }));
      invalidate();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });
  const hand = trpc.pharmacyRetail.handToFinance.useMutation({
    onSuccess: () => {
      toast.success(t('cash.handed', { defaultValue: 'Finansa teslim edildi' }));
      invalidate();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });
  // #664 — finans mutabakatı (2-aşama ikinci ayak). Yalnız finans/yönetici görür.
  const canReconcile = usePermission('action:pharmacy.cashReconcile');
  const reconcile = trpc.pharmacyRetail.reconcileCash.useMutation({
    onSuccess: () => {
      toast.success(t('cash.reconciled', { defaultValue: 'Kasa mutabık edildi' }));
      invalidate();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.pharmacyCash', { defaultValue: 'Kasa (Gün Sonu)' })}
        description={t('cash.description', {
          defaultValue: 'Kasa aç/kapat, say, finansa teslim et.',
        })}
      />

      <section className="rounded-lg border bg-card p-4">
        {!cur ? (
          <div className="flex items-end gap-3">
            <div>
              <Label>{t('cash.openingFloat', { defaultValue: 'Açılış kasası' })}</Label>
              <Input
                type="number"
                min={0}
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
              />
            </div>
            <Button
              onClick={() =>
                open.mutate({ openingFloat: parseFloat(opening) || 0, currency: 'TJS' })
              }
            >
              <Banknote className="mr-2 h-4 w-4" />
              {t('cash.open', { defaultValue: 'Kasa Aç' })}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">
                  {t('cash.openCash', { defaultValue: 'Açık kasa' })}
                </span>
                <Badge variant={STATUS_VARIANT[cur.status]}>
                  {t(`cash.status.${cur.status}`, { defaultValue: cur.status })}
                </Badge>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {t('cash.openingFloat', { defaultValue: 'Açılış' })}:{' '}
                {Number(cur.openingFloat).toFixed(2)} TJS
              </div>
            </div>
            <Button variant="outline" onClick={() => setCloseTarget(cur)}>
              <Lock className="mr-2 h-4 w-4" />
              {t('cash.close', { defaultValue: 'Kasa Kapat' })}
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card">
        <header className="border-b px-4 py-3 text-sm font-semibold">
          {t('cash.history', { defaultValue: 'Kasa Geçmişi' })}
        </header>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('cash.colDate', { defaultValue: 'Tarih' })}</TableHead>
              <TableHead>{t('cash.colStatus', { defaultValue: 'Durum' })}</TableHead>
              <TableHead className="text-right">
                {t('cash.colExpected', { defaultValue: 'Beklenen' })}
              </TableHead>
              <TableHead className="text-right">
                {t('cash.colCounted', { defaultValue: 'Sayılan' })}
              </TableHead>
              <TableHead className="text-right">
                {t('cash.colVariance', { defaultValue: 'Sapma' })}
              </TableHead>
              <TableHead className="text-right">
                {t('cash.colActions', { defaultValue: 'İşlem' })}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  {t('cash.empty', { defaultValue: 'Kasa kaydı yok.' })}
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{new Date(c.businessDate).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[c.status]}>
                    {t(`cash.status.${c.status}`, { defaultValue: c.status })}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {Number(c.expectedAmount).toFixed(2)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.countedAmount != null ? Number(c.countedAmount).toFixed(2) : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.variance != null ? Number(c.variance).toFixed(2) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {c.status === 'closed' && (
                    <Button size="sm" variant="outline" onClick={() => hand.mutate({ id: c.id })}>
                      <Send className="mr-1 h-4 w-4" />
                      {t('cash.handToFinance', { defaultValue: 'Finansa teslim' })}
                    </Button>
                  )}
                  {/* #664 — finansa teslim edilmiş + henüz mutabık değilse: finans onayı */}
                  {c.status === 'handed_to_finance' && !c.reconciledAt && canReconcile && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reconcile.mutate({ id: c.id })}
                      disabled={reconcile.isPending}
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" />
                      {t('cash.reconcile', { defaultValue: 'Mutabakatla' })}
                    </Button>
                  )}
                  {c.reconciledAt && (
                    <Badge variant="secondary">
                      {t('cash.reconciledBadge', { defaultValue: 'Mutabık' })}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {closeTarget && (
        <CashCloseDialog
          closure={closeTarget}
          onClose={() => setCloseTarget(null)}
          onSaved={() => {
            invalidate();
            setCloseTarget(null);
          }}
        />
      )}
    </div>
  );
}

function CashCloseDialog({
  closure,
  onClose,
  onSaved,
}: {
  closure: Closure;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['common']);
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const close = trpc.pharmacyRetail.closeCash.useMutation({
    onSuccess: () => {
      toast.success(t('cash.closed', { defaultValue: 'Kasa kapatıldı' }));
      onSaved();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>{t('cash.close', { defaultValue: 'Kasa Kapat' })}</DialogTitle>
        <DialogDescription>
          {t('cash.closeHint', { defaultValue: 'Fiziksel sayımı girin; sistem sapmayı hesaplar.' })}
        </DialogDescription>
        <div className="mt-2 space-y-3">
          <div>
            <Label>{t('cash.counted', { defaultValue: 'Sayılan tutar' })}</Label>
            <Input
              type="number"
              min={0}
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <Label>{t('cash.notes', { defaultValue: 'Not' })}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            disabled={close.isPending || counted === ''}
            onClick={() =>
              close.mutate({
                id: closure.id,
                countedAmount: parseFloat(counted) || 0,
                notes: notes.trim() || null,
              })
            }
          >
            {t('cash.close', { defaultValue: 'Kapat' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
