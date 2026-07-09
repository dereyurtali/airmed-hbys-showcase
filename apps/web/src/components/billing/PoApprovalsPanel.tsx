import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, ChevronDown, ChevronRight, ClipboardCheck, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';
import { usePermission } from '../../hooks/usePermission';
import { ApprovalRejectDialog } from './ApprovalRejectDialog';

// R7 (#729) — Onay öncesi kalem detayı: procurement'ın girdiği birim fiyatlar
// READ-ONLY gösterilir (Karar 8: finans fiyatı değiştirmez, görerek onaylar).
type PoDetailItem = { id: string; itemName: string; quantity: number; unitPrice: string };

function PoApprovalDetail({ poId, currency }: { poId: string; currency: string }) {
  const { t } = useTranslation(['common']);
  const detail = trpc.purchaseOrder.byId.useQuery({ id: poId });
  const items = (detail.data?.items ?? []) as PoDetailItem[];
  if (detail.isLoading) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">{t('states.loading')}</p>;
  }
  return (
    <div className="bg-muted/20 px-4 py-3">
      <p className="mb-2 text-xs text-muted-foreground">
        {t('po.priceReadonlyNote', {
          defaultValue: 'Birim fiyatlar procurement tarafından girildi (read-only).',
        })}
      </p>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-medium">
              {t('po.colItem', { defaultValue: 'Kalem' })}
            </th>
            <th className="py-1 text-right font-medium">
              {t('po.colQty', { defaultValue: 'Adet' })}
            </th>
            <th className="py-1 text-right font-medium">
              {t('po.colUnitPrice', { defaultValue: 'Birim fiyat' })}
            </th>
            <th className="py-1 text-right font-medium">
              {t('po.colLineTotal', { defaultValue: 'Tutar' })}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t">
              <td className="py-1">{it.itemName}</td>
              <td className="py-1 text-right tabular-nums">{it.quantity}</td>
              <td className="py-1 text-right tabular-nums">
                {Number(it.unitPrice).toFixed(2)} {currency}
              </td>
              <td className="py-1 text-right font-medium tabular-nums">
                {(it.quantity * Number(it.unitPrice)).toFixed(2)} {currency}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// R4 (#726) — Onay bekleyen Satın Alma Siparişleri panel'i. Sekmeli /approvals
// modülü (PO sekmesi) ve Yönetici Genel Bakış aynı panel'i kullanır (DRY). Ayrı
// /purchase-orders/approvals sayfası #904'te kaldırıldı → tek kanonik giriş
// /approvals. Görev ayrılığı (oluşturan ≠ onaylayan) service katmanında (#549);
// burada yalnız UX. action:po.approve yoksa null döner.

export function PoApprovalsPanel() {
  const { t } = useTranslation(['common']);
  const canApprove = usePermission('action:po.approve');
  const utils = trpc.useUtils();
  const [busyId, setBusyId] = useState<string | null>(null);
  // #726 — red gerekçesi dialog'la alınır (poRejectSchema.reason opsiyonel).
  const [rejectId, setRejectId] = useState<string | null>(null);
  // R7 (#729) — kalem detayı (birim fiyat read-only) için açık satır.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const listQuery = trpc.purchaseOrder.list.useQuery(
    { pendingApprovalOnly: true },
    { enabled: canApprove, refetchInterval: 30_000 },
  );
  const rows = listQuery.data ?? [];
  const invalidate = () => void utils.purchaseOrder.list.invalidate();

  const approve = trpc.purchaseOrder.approve.useMutation({
    onSuccess: () => {
      toast.success(t('po.approved', { defaultValue: 'Sipariş onaylandı' }));
      invalidate();
      setBusyId(null);
    },
    onError: (e) => {
      toast.error(mapTrpcError(e, t));
      setBusyId(null);
    },
  });
  const reject = trpc.purchaseOrder.reject.useMutation({
    onSuccess: () => {
      toast.success(t('po.rejected', { defaultValue: 'Sipariş reddedildi' }));
      invalidate();
      setBusyId(null);
      setRejectId(null);
    },
    onError: (e) => {
      toast.error(mapTrpcError(e, t));
      setBusyId(null);
    },
  });

  if (!canApprove) return null;

  return (
    <section className="rounded-lg border bg-card" data-testid="po-approvals-panel">
      <header className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
        <ClipboardCheck className="h-4 w-4" />
        {t('po.pendingTitle', { defaultValue: 'Onay Kuyruğu' })}
        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning-bg px-1.5 text-xs font-semibold tabular-nums text-warning-foreground">
          {rows.length}
        </span>
      </header>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('po.colNo', { defaultValue: 'No' })}</TableHead>
            <TableHead>{t('po.colSupplier', { defaultValue: 'Tedarikçi' })}</TableHead>
            <TableHead className="text-right">
              {t('po.colTotal', { defaultValue: 'Tutar' })}
            </TableHead>
            <TableHead className="text-right">
              {t('po.colActions', { defaultValue: 'İşlem' })}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                {t('po.noPending', { defaultValue: 'Onay bekleyen sipariş yok.' })}
              </TableCell>
            </TableRow>
          )}
          {rows.map((po) => (
            <Fragment key={po.id}>
              <TableRow>
                <TableCell className="font-medium">
                  <button
                    type="button"
                    onClick={() => setExpandedId((id) => (id === po.id ? null : po.id))}
                    className="inline-flex items-center gap-1 hover:text-primary"
                    aria-expanded={expandedId === po.id}
                    data-testid={`po-expand-${po.id}`}
                  >
                    {expandedId === po.id ? (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {po.orderNo}
                  </button>
                </TableCell>
                <TableCell>{po.supplier?.name ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {Number(po.totalAmount).toFixed(2)} {po.currency}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === po.id}
                      onClick={() => {
                        setBusyId(po.id);
                        approve.mutate({ id: po.id });
                      }}
                    >
                      <Check className="mr-1 h-4 w-4" />
                      {t('po.approve', { defaultValue: 'Onayla' })}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === po.id}
                      onClick={() => setRejectId(po.id)}
                    >
                      <X className="mr-1 h-4 w-4 text-destructive" />
                      {t('po.reject', { defaultValue: 'Reddet' })}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              {expandedId === po.id && (
                <TableRow>
                  <TableCell colSpan={4} className="p-0">
                    <PoApprovalDetail poId={po.id} currency={po.currency} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>

      <ApprovalRejectDialog
        open={rejectId !== null}
        onOpenChange={(o) => !o && setRejectId(null)}
        pending={reject.isPending}
        title={t('po.rejectTitle', { defaultValue: 'Siparişi reddet' })}
        onConfirm={(reason) => {
          if (!rejectId) return;
          setBusyId(rejectId);
          reject.mutate({ id: rejectId, reason });
        }}
      />
    </section>
  );
}
