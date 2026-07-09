import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Boxes, PackagePlus, Plus } from 'lucide-react';
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

// v0.4 #555 — Eczane Stoğu + Mal Kabul. Ürün katalog + parti (lot/SKT/fiyat).
// Mantık #552. Tedarikçi ekranı ayrı (/suppliers, #547).

interface Batch {
  id: string;
  availableQty: number;
  expiresAt: string | null;
  salePrice: string | number;
}
interface Product {
  id: string;
  name: string;
  code: string;
  category: string | null;
  unit: string | null;
  batches: Batch[];
}

export function PharmacyStockPage() {
  const { t } = useTranslation(['common']);
  const utils = trpc.useUtils();
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [intakeFor, setIntakeFor] = useState<Product | null>(null);

  const listQuery = trpc.pharmacyRetail.listProducts.useQuery({ includeInactive: false });
  const rows = (listQuery.data ?? []) as unknown as Product[];
  const invalidate = () => void utils.pharmacyRetail.listProducts.invalidate();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.pharmacyStock', { defaultValue: 'Eczane Stoğu' })}
        description={t('phStock.description', {
          defaultValue: 'Ürün katalog + parti (lot/SKT/fiyat) + mal kabul.',
        })}
        actions={
          <Button onClick={() => setCreatingProduct(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('phStock.newProduct', { defaultValue: 'Yeni ürün' })}
          </Button>
        }
      />
      <section className="rounded-lg border bg-card">
        <header className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
          <Boxes className="h-4 w-4" />
          {t('phStock.products', { defaultValue: 'Ürünler' })}
        </header>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('phStock.colName', { defaultValue: 'Ürün' })}</TableHead>
              <TableHead>{t('phStock.colCategory', { defaultValue: 'Grup' })}</TableHead>
              <TableHead className="text-right">
                {t('phStock.colStock', { defaultValue: 'Stok' })}
              </TableHead>
              <TableHead>{t('phStock.colExpiry', { defaultValue: 'En yakın SKT' })}</TableHead>
              <TableHead className="text-right">
                {t('phStock.colActions', { defaultValue: 'İşlem' })}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {t('phStock.empty', { defaultValue: 'Henüz ürün yok.' })}
                </TableCell>
              </TableRow>
            )}
            {rows.map((p) => {
              const stock = p.batches.reduce((s, b) => s + b.availableQty, 0);
              const nextExp = p.batches
                .filter((b) => b.availableQty > 0 && b.expiresAt)
                .map((b) => b.expiresAt as string)
                .sort()[0];
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.code}</div>
                  </TableCell>
                  <TableCell className="text-sm">{p.category ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {stock} {p.unit ?? ''}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {nextExp ? new Date(nextExp).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setIntakeFor(p)}>
                      <PackagePlus className="mr-1 h-4 w-4" />
                      {t('phStock.intake', { defaultValue: 'Mal kabul' })}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      {creatingProduct && (
        <ProductDialog
          onClose={() => setCreatingProduct(false)}
          onSaved={() => {
            invalidate();
            setCreatingProduct(false);
          }}
        />
      )}
      {intakeFor && (
        <IntakeDialog
          product={intakeFor}
          onClose={() => setIntakeFor(null)}
          onSaved={() => {
            invalidate();
            setIntakeFor(null);
          }}
        />
      )}
    </div>
  );
}

function ProductDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation(['common']);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('drug');
  const [unit, setUnit] = useState('');
  const create = trpc.pharmacyRetail.createProduct.useMutation({
    onSuccess: () => {
      toast.success(t('phStock.productCreated', { defaultValue: 'Ürün eklendi' }));
      onSaved();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>{t('phStock.newProduct', { defaultValue: 'Yeni ürün' })}</DialogTitle>
        <DialogDescription>
          {t('phStock.productHint', { defaultValue: 'Perakende ürün kartı (parti ayrı eklenir).' })}
        </DialogDescription>
        <div className="mt-2 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('phStock.colCode', { defaultValue: 'Kod' })}</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            </div>
            <div>
              <Label>{t('phStock.colCategory', { defaultValue: 'Grup' })}</Label>
              <select
                className="focus-ring h-10 w-full rounded-lg border border-field bg-background px-3 text-sm hover:border-field-hover"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="drug">{t('phStock.cat.drug', { defaultValue: 'İlaç' })}</option>
                <option value="supply">{t('phStock.cat.supply', { defaultValue: 'Sarf' })}</option>
                <option value="cosmetic">
                  {t('phStock.cat.cosmetic', { defaultValue: 'Kozmetik' })}
                </option>
                <option value="other">{t('phStock.cat.other', { defaultValue: 'Diğer' })}</option>
              </select>
            </div>
          </div>
          <div>
            <Label>{t('phStock.colName', { defaultValue: 'Ad' })}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>{t('phStock.colUnit', { defaultValue: 'Birim' })}</Label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kutu" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            disabled={create.isPending || !code.trim() || !name.trim()}
            onClick={() =>
              create.mutate({
                code: code.trim(),
                name: name.trim(),
                category,
                unit: unit.trim() || null,
                requiresPrescription: category === 'drug',
              })
            }
          >
            {t('actions.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IntakeDialog({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['common']);
  const [lotNumber, setLotNumber] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [salePrice, setSalePrice] = useState('0');
  const [costPrice, setCostPrice] = useState('');
  const [quantity, setQuantity] = useState('0');
  const create = trpc.pharmacyRetail.createBatch.useMutation({
    onSuccess: () => {
      toast.success(t('phStock.intakeDone', { defaultValue: 'Mal kabul yapıldı' }));
      onSaved();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>
          {t('phStock.intakeFor', {
            name: product.name,
            defaultValue: `Mal kabul — ${product.name}`,
          })}
        </DialogTitle>
        <DialogDescription>
          {t('phStock.intakeHint', { defaultValue: 'Parti: lot, SKT, satış fiyatı, adet.' })}
        </DialogDescription>
        <div className="mt-2 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('phStock.lot', { defaultValue: 'Lot' })}</Label>
              <Input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} />
            </div>
            <div>
              <Label>{t('phStock.expiry', { defaultValue: 'SKT' })}</Label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>{t('phStock.salePrice', { defaultValue: 'Satış ₸' })}</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
              />
            </div>
            <div>
              <Label>{t('phStock.costPrice', { defaultValue: 'Alış ₸' })}</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
              />
            </div>
            <div>
              <Label>{t('phStock.qty', { defaultValue: 'Adet' })}</Label>
              <Input
                type="number"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            disabled={create.isPending || parseFloat(salePrice) < 0}
            onClick={() =>
              create.mutate({
                productId: product.id,
                lotNumber: lotNumber.trim() || null,
                expiresAt: expiresAt ? new Date(`${expiresAt}T00:00:00`).toISOString() : null,
                salePrice: parseFloat(salePrice) || 0,
                costPrice: costPrice ? parseFloat(costPrice) : null,
                currency: 'TJS',
                quantity: parseInt(quantity, 10) || 0,
              })
            }
          >
            {t('phStock.receive', { defaultValue: 'Mal kabul' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
