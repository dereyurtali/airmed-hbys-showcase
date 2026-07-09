import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Plus, Trash2, Truck, X } from 'lucide-react';
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
import { hasPermission } from '@airmed/contracts';
import { useAuth } from '../providers/AuthProvider';
import { PoReceiveDialog } from '../components/purchase-order/PoReceiveDialog';

// v0.4 #550 — Satın Alma Siparişi liste + oluştur + aksiyonlar (Stok&SatınAlma).
// Onay kuyruğu sekmeli /approvals modülünün PO sekmesinde (#904). Mantık #549'da.

type PoStatus = 'draft' | 'submitted' | 'pending_approval' | 'approved' | 'received' | 'cancelled';

const STATUS_VARIANT: Record<PoStatus, 'default' | 'secondary' | 'outline'> = {
  draft: 'outline',
  submitted: 'secondary',
  pending_approval: 'default',
  approved: 'default',
  received: 'secondary',
  cancelled: 'outline',
};

interface ItemDraft {
  itemName: string;
  quantity: string;
  unitPrice: string;
  // #713 — stok varlığı bağı (domain'e göre consumable/pharmacy_product). Boş =
  // serbest kalem (mal kabulde stok artmaz). Doluysa receive ilgili stoğu artırır.
  referenceId: string;
}

export function PurchaseOrdersPage() {
  const { t } = useTranslation(['common']);
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const utils = trpc.useUtils();
  const [creating, setCreating] = useState(false);
  // R8 (#730) — mal kabul artık kalem-bazlı kısmi teslim dialog'u açar.
  const [receivingPoId, setReceivingPoId] = useState<string | null>(null);

  const canCreate = hasPermission(roles, 'action:po.create');
  const listQuery = trpc.purchaseOrder.list.useQuery({});
  const rows = listQuery.data ?? [];

  const invalidate = () => void utils.purchaseOrder.list.invalidate();
  const submit = trpc.purchaseOrder.submit.useMutation({
    onSuccess: invalidate,
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });
  const cancel = trpc.purchaseOrder.cancel.useMutation({
    onSuccess: invalidate,
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.purchaseOrders', { defaultValue: 'Satın Alma Siparişleri' })}
        description={t('po.description', {
          defaultValue: 'Sipariş oluştur, onaya gönder, mal kabul yap.',
        })}
        actions={
          canCreate ? (
            <Button onClick={() => setCreating(true)} data-testid="po-new">
              <Plus className="mr-2 h-4 w-4" />
              {t('po.new', { defaultValue: 'Yeni sipariş' })}
            </Button>
          ) : undefined
        }
      />

      <section className="rounded-lg border bg-card">
        <header className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
          <Truck className="h-4 w-4" />
          {t('po.listTitle', { defaultValue: 'Siparişler' })}
        </header>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('po.colNo', { defaultValue: 'No' })}</TableHead>
              <TableHead>{t('po.colSupplier', { defaultValue: 'Tedarikçi' })}</TableHead>
              <TableHead>{t('po.colStatus', { defaultValue: 'Durum' })}</TableHead>
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
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {t('po.empty', { defaultValue: 'Henüz sipariş yok.' })}
                </TableCell>
              </TableRow>
            )}
            {rows.map((po) => {
              const status = po.status as PoStatus;
              return (
                <TableRow key={po.id}>
                  <TableCell className="font-medium">{po.orderNo}</TableCell>
                  <TableCell>{po.supplier?.name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[status]}>
                      {t(`po.status.${status}`, { defaultValue: status })}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(po.totalAmount).toFixed(2)} {po.currency}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {status === 'draft' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => submit.mutate({ id: po.id })}
                        >
                          {t('po.submit', { defaultValue: 'Onaya gönder' })}
                        </Button>
                      )}
                      {(status === 'submitted' || status === 'approved') && (
                        <Button size="sm" variant="outline" onClick={() => setReceivingPoId(po.id)}>
                          {t('po.receive', { defaultValue: 'Mal kabul' })}
                        </Button>
                      )}
                      {status !== 'received' && status !== 'cancelled' && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title={t('po.cancel', { defaultValue: 'İptal' })}
                          onClick={() => cancel.mutate({ id: po.id })}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      {creating && (
        <PoCreateDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            invalidate();
            setCreating(false);
          }}
        />
      )}

      {receivingPoId && (
        <PoReceiveDialog
          poId={receivingPoId}
          onClose={() => setReceivingPoId(null)}
          onReceived={invalidate}
        />
      )}
    </div>
  );
}

function PoCreateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation(['common']);
  const [supplierId, setSupplierId] = useState('');
  const [domain, setDomain] = useState<'clinic' | 'pharmacy'>('clinic');
  const [items, setItems] = useState<ItemDraft[]>([
    { itemName: '', quantity: '1', unitPrice: '0', referenceId: '' },
  ]);

  const suppliers = trpc.pharmacy.listSuppliers.useQuery({ includeInactive: false });
  // #713 — domain'e göre referanslanabilir stok varlıkları (mal kabul → stok için).
  const refOptions = trpc.purchaseOrder.referenceOptions.useQuery();
  const stockEntities =
    domain === 'pharmacy'
      ? (refOptions.data?.pharmacyProducts ?? [])
      : (refOptions.data?.consumables ?? []);
  const referenceType = domain === 'pharmacy' ? 'pharmacy_product' : 'consumable';
  // v0.4.2 R8 (Karar 8) — create+submit ayrılmaz: "Gönder & Onaya Sun" tek aksiyon.
  // Oluştur → otomatik onaya gönder (taslak limbo yok; görev ayrılığı: onay finansta).
  const submit = trpc.purchaseOrder.submit.useMutation({
    onSuccess: () => {
      toast.success(t('po.submitted', { defaultValue: 'Sipariş onaya gönderildi' }));
      onSaved();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });
  const create = trpc.purchaseOrder.create.useMutation({
    onSuccess: (po) => submit.mutate({ id: po.id }),
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  const total = items.reduce(
    (s, it) => s + (parseInt(it.quantity, 10) || 0) * (parseFloat(it.unitPrice) || 0),
    0,
  );

  const setItem = (idx: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  // Domain değişince stok bağları geçersiz (consumable ↔ pharmacy_product) → temizle.
  const changeDomain = (d: 'clinic' | 'pharmacy') => {
    setDomain(d);
    setItems((prev) => prev.map((it) => ({ ...it, referenceId: '' })));
  };

  const onSubmit = () => {
    if (!supplierId) return;
    const valid = items.filter((it) => it.itemName.trim() && parseInt(it.quantity, 10) > 0);
    if (valid.length === 0) {
      toast.error(t('po.itemsInvalid', { defaultValue: 'En az bir geçerli kalem girin' }));
      return;
    }
    create.mutate({
      supplierId,
      domain,
      currency: 'TJS',
      items: valid.map((it) => ({
        itemName: it.itemName.trim(),
        quantity: parseInt(it.quantity, 10),
        unitPrice: parseFloat(it.unitPrice) || 0,
        // #713 — stok bağı varsa receive ilgili stoğu artırır; yoksa serbest kalem.
        ...(it.referenceId
          ? {
              referenceType: referenceType as 'consumable' | 'pharmacy_product',
              referenceId: it.referenceId,
            }
          : {}),
      })),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{t('po.new', { defaultValue: 'Yeni sipariş' })}</DialogTitle>
        <DialogDescription>
          {t('po.formHint', { defaultValue: 'Tedarikçi seç, kalemleri gir, oluştur.' })}
        </DialogDescription>
        <div className="mt-2 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('po.colSupplier', { defaultValue: 'Tedarikçi' })}</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">—</option>
                {(suppliers.data ?? []).map((s: { id: string; name: string }) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>{t('po.colDomain', { defaultValue: 'Alan' })}</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={domain}
                onChange={(e) => changeDomain(e.target.value as 'clinic' | 'pharmacy')}
              >
                <option value="clinic">{t('po.domain.clinic', { defaultValue: 'Klinik' })}</option>
                <option value="pharmacy">
                  {t('po.domain.pharmacy', { defaultValue: 'Eczane' })}
                </option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label>{t('po.items', { defaultValue: 'Kalemler' })}</Label>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setItems((prev) => [
                  ...prev,
                  { itemName: '', quantity: '1', unitPrice: '0', referenceId: '' },
                ])
              }
            >
              <Plus className="mr-1 h-3 w-3" />
              {t('po.addItem', { defaultValue: 'Kalem ekle' })}
            </Button>
          </div>
          {items.map((item, idx) => (
            <div key={idx} className="space-y-1.5 rounded-lg border p-2">
              <div className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-6">
                  <Input
                    placeholder={t('po.itemName', { defaultValue: 'Ürün adı' })}
                    value={item.itemName}
                    onChange={(e) => setItem(idx, { itemName: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) => setItem(idx, { quantity: e.target.value })}
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => setItem(idx, { unitPrice: e.target.value })}
                  />
                </div>
                <div className="col-span-1">
                  {items.length > 1 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              {/* #713 — stok bağı: seçilirse mal kabulde ilgili stok artar. */}
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={item.referenceId}
                onChange={(e) => {
                  const refId = e.target.value;
                  const entity = stockEntities.find((s) => s.id === refId);
                  setItem(idx, {
                    referenceId: refId,
                    ...(entity && !item.itemName.trim() ? { itemName: entity.name } : {}),
                  });
                }}
              >
                <option value="">
                  {t('po.noStockLink', { defaultValue: '— stok bağı yok (serbest kalem) —' })}
                </option>
                {stockEntities.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code ? `${s.code} · ${s.name}` : s.name}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <div className="flex items-center justify-end gap-2 border-t pt-3 text-sm font-medium">
            {t('po.colTotal', { defaultValue: 'Tutar' })}: {total.toFixed(2)} TJS
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={create.isPending || submit.isPending || !supplierId}>
            <Check className="mr-2 h-4 w-4" />
            {t('po.createAndSubmit', { defaultValue: 'Gönder & Onaya Sun' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
