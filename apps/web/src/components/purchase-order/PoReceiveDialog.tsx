import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';

// R8 (#730) — Mal kabul: kalem-bazlı KISMİ teslim. Beklenen miktar default;
// kullanıcı her kalemde gerçek teslim alınanı girer (0..quantity). Backend
// receive() kalem-bazlı receivedQty'yi destekler (kısmi/backorder).

type PoItem = { id: string; itemName: string; quantity: number; unitPrice: string };

export function PoReceiveDialog({
  poId,
  onClose,
  onReceived,
}: {
  poId: string;
  onClose: () => void;
  onReceived: () => void;
}) {
  const { t } = useTranslation(['common']);
  const detail = trpc.purchaseOrder.byId.useQuery({ id: poId });
  const items = (detail.data?.items ?? []) as PoItem[];

  // Kalem id → teslim alınan miktar (default beklenen quantity).
  const [received, setReceived] = useState<Record<string, number>>({});
  const qtyFor = (it: PoItem) => received[it.id] ?? it.quantity;

  const receive = trpc.purchaseOrder.receive.useMutation({
    onSuccess: () => {
      toast.success(t('po.received', { defaultValue: 'Mal kabul yapıldı' }));
      onReceived();
      onClose();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  const partial = items.some((it) => qtyFor(it) < it.quantity);

  const setQty = (it: PoItem, raw: string) => {
    const n = Math.max(0, Math.min(it.quantity, Math.floor(Number(raw) || 0)));
    setReceived((prev) => ({ ...prev, [it.id]: n }));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{t('po.receiveTitle', { defaultValue: 'Mal Kabul' })}</DialogTitle>
        <DialogDescription>
          {t('po.receiveHint', {
            defaultValue: 'Her kalemde gerçek teslim alınan miktarı girin. Eksik = kısmi teslim.',
          })}
        </DialogDescription>

        {detail.isLoading ? (
          <p className="py-6 text-sm text-muted-foreground">{t('states.loading')}</p>
        ) : (
          <Table className="mt-2">
            <TableHeader>
              <TableRow>
                <TableHead>{t('po.colItem', { defaultValue: 'Kalem' })}</TableHead>
                <TableHead className="text-right">
                  {t('po.colOrdered', { defaultValue: 'Sipariş' })}
                </TableHead>
                <TableHead className="text-right">
                  {t('po.colReceived', { defaultValue: 'Teslim alınan' })}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => {
                const q = qtyFor(it);
                const short = q < it.quantity;
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{it.itemName}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {it.quantity}
                    </TableCell>
                    <TableCell className="text-right">
                      <input
                        type="number"
                        min={0}
                        max={it.quantity}
                        value={q}
                        onChange={(e) => setQty(it, e.target.value)}
                        aria-label={t('po.colReceived', { defaultValue: 'Teslim alınan' })}
                        className={`h-9 w-20 rounded-md border bg-background px-2 text-right text-sm tabular-nums ${
                          short ? 'border-warning-border text-warning-foreground' : 'border-input'
                        }`}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {partial && (
          <p className="mt-2 text-xs text-warning-foreground">
            {t('po.partialWarn', {
              defaultValue: 'Kısmi teslim: eksik kalemler backorder olarak kalır.',
            })}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            disabled={receive.isPending || items.length === 0}
            onClick={() =>
              receive.mutate({
                id: poId,
                items: items.map((it) => ({ itemId: it.id, receivedQty: qtyFor(it) })),
              })
            }
            data-testid="po-receive-confirm"
          >
            {t('po.receiveConfirm', { defaultValue: 'Mal kabulü onayla' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
