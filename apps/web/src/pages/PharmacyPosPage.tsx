import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  FileText,
  X,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog';
import { trpc } from '../lib/trpc';
import { mapTrpcError } from '../lib/trpc-error';

// v0.4 #553 — Eczane Satış (POS). Ürün ara → sepete ekle (FEFO parti) → tahsilat.
// KVKK: varsayılan anonim walk-in. Mantık #552'de.
// #712 — ?rx=<id> ile reçete kuyruğundan açılırsa satış o reçete + hastaya BAĞLANIR
// (prescriptionId + isAnonymous=false); reçete kalemleri rehber olarak gösterilir.
// #711 — reçeteli (requiresPrescription) ürün sepetteyse reçete bağı ZORUNLU
// (anonim satış kapanır; backend de 400 ile korur).

type PaymentMethod = 'cash' | 'card' | 'transfer' | 'insurance';

interface Batch {
  id: string;
  salePrice: string | number;
  availableQty: number;
  expiresAt: string | null;
  lotNumber: string | null;
}
interface Product {
  id: string;
  name: string;
  code: string;
  unit: string | null;
  category: string | null;
  requiresPrescription: boolean;
  batches: Batch[];
}
interface RxItem {
  name?: string;
  dose?: string;
}
interface RxDetail {
  id: string;
  items: unknown;
  patient: { id: string; firstName: string; lastName: string; mrn: string | null } | null;
}
interface CartLine {
  productId: string;
  batchId: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  maxQty: number;
  // #790 — eczacının manuel eşlediği reçete kalemi (muadil/kısmi audit izi).
  prescriptionItemLabel?: string;
}

// FEFO: stoklu, en erken SKT'li parti.
function pickBatch(p: Product): Batch | null {
  const usable = p.batches.filter((b) => b.availableQty > 0);
  if (usable.length === 0) return null;
  return usable.sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999'))[0];
}

export function PharmacyPosPage() {
  const { t } = useTranslation(['common']);
  const utils = trpc.useUtils();
  const [searchParams, setSearchParams] = useSearchParams();
  const rxId = searchParams.get('rx');
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  // #790 — eczacı reçete kaleminde "Ara"ya basınca o kalemi "eşlenecek" işaretler;
  // bir sonraki sepete eklenen ürün bu reçete kalemini karşılar (manuel = güvenli).
  const [activeRxLabel, setActiveRxLabel] = useState<string | null>(null);
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  // Karar 9 — POS >%10 indirim süpervizör (yönetici/finans) onayı dialog'u.
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [ovEmail, setOvEmail] = useState('');
  const [ovPassword, setOvPassword] = useState('');

  const listQuery = trpc.pharmacyRetail.listProducts.useQuery({ includeInactive: false });
  const products = (listQuery.data ?? []) as unknown as Product[];

  // #712 — reçeteye bağlı satış: ?rx= varsa reçeteyi çek, satış o hastaya bağlanır.
  const rxQuery = trpc.pharmacy.findPrescriptionById.useQuery(
    { id: rxId ?? '' },
    { enabled: !!rxId },
  );
  const rx = rxQuery.data as unknown as RxDetail | undefined;
  const rxItems: RxItem[] = Array.isArray(rx?.items) ? (rx!.items as RxItem[]) : [];

  // #711 — sepette reçeteli ürün var mı? (ürün id → requiresPrescription)
  const rxRequiredByProduct = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const p of products) m.set(p.id, p.requiresPrescription);
    return m;
  }, [products]);
  const cartHasRx = cart.some((l) => rxRequiredByProduct.get(l.productId) === true);
  const prescriptionId = rx?.id ?? null;
  // Reçete bağlı VEYA hiç reçeteli ürün yok → satılabilir. Reçeteli ürün var ama
  // reçete bağı yok → engelle (backend de 400 verir; UI önden uyarır).
  const rxBlocked = cartHasRx && !prescriptionId;

  // R9 #731 — kategori hızlı filtre: ürünlerin dolu kategorilerinden türetilir.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => (activeCat ? p.category === activeCat : true))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
      .slice(0, 30);
  }, [products, search, activeCat]);

  const subtotal = cart.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const total = Math.max(0, subtotal - discount);
  // Karar 9 — indirim ara-toplamın %10'unu aşarsa süpervizör onayı gerekir.
  const discountPct = subtotal > 0 ? (discount / subtotal) * 100 : 0;
  const needsOverride = discountPct > 10;

  const clearRx = () => {
    setSearchParams({}, { replace: true });
    setCart([]);
  };

  const sell = trpc.pharmacyRetail.createSale.useMutation({
    onSuccess: () => {
      toast.success(t('pos.completed', { defaultValue: 'Satış tamamlandı' }));
      setCart([]);
      setDiscount(0);
      setOverrideOpen(false);
      setOvEmail('');
      setOvPassword('');
      if (rxId) setSearchParams({}, { replace: true });
      void utils.pharmacyRetail.listProducts.invalidate();
      void utils.pharmacyRetail.dispensablePrescriptions.invalidate();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  // #790 — eczacı reçeteyi dağıttıkça durumu işaretler (kısmi/tam).
  const markDispense = trpc.pharmacyRetail.markPrescriptionDispense.useMutation({
    onSuccess: (_d, vars) => {
      toast.success(
        vars.status === 'dispensed'
          ? t('pos.rxDispensedToast', { defaultValue: 'Reçete tam dağıtıldı olarak işaretlendi' })
          : t('pos.rxPartialToast', { defaultValue: 'Reçete kısmi dağıtıldı olarak işaretlendi' }),
      );
      void utils.pharmacyRetail.dispensablePrescriptions.invalidate();
      if (vars.status === 'dispensed' && rxId) setSearchParams({}, { replace: true });
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  // Reçete kalemini "eşlenecek" işaretle: aramayı doldur + sonraki eklenen ürün bunu karşılar.
  const startMapRxItem = (label: string) => {
    setActiveRxLabel(label);
    setSearch(label);
    setActiveCat(null);
  };

  const addToCart = (p: Product) => {
    const batch = pickBatch(p);
    if (!batch) {
      toast.error(t('pos.outOfStock', { defaultValue: 'Stokta yok' }));
      return;
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.batchId === batch.id);
      if (existing) {
        if (existing.quantity >= existing.maxQty) return prev;
        return prev.map((l) => (l.batchId === batch.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          productId: p.id,
          batchId: batch.id,
          itemName: p.name,
          quantity: 1,
          unitPrice: Number(batch.salePrice),
          maxQty: batch.availableQty,
          prescriptionItemLabel: activeRxLabel ?? undefined,
        },
      ];
    });
    // Reçete kalemi eşlemesi tek seferlik; eşledikten sonra temizle.
    if (activeRxLabel) setActiveRxLabel(null);
  };

  const changeQty = (batchId: string, delta: number) =>
    setCart((prev) =>
      prev
        .map((l) =>
          l.batchId === batchId
            ? { ...l, quantity: Math.max(0, Math.min(l.maxQty, l.quantity + delta)) }
            : l,
        )
        .filter((l) => l.quantity > 0),
    );

  const doSell = (supervisorOverride?: { email: string; password: string }) => {
    sell.mutate({
      items: cart.map((l) => ({
        productId: l.productId,
        batchId: l.batchId,
        itemName: l.itemName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        prescriptionItemLabel: l.prescriptionItemLabel ?? null,
      })),
      // Reçete bağlı satış hastaya bağlanır; aksi halde anonim walk-in (KVKK).
      isAnonymous: !prescriptionId,
      patientId: rx?.patient?.id ?? null,
      prescriptionId,
      discount,
      currency: 'TJS',
      paymentMethod,
      supervisorOverride,
    });
  };

  const checkout = () => {
    if (cart.length === 0) return;
    if (rxBlocked) {
      toast.error(
        t('pos.rxRequired', {
          defaultValue: 'Reçeteli ürün için reçete bağlanmalı (anonim satış kapalı).',
        }),
      );
      return;
    }
    // Karar 9 — >%10 indirim: doğrudan satma, süpervizör PIN dialog'unu aç.
    if (needsOverride) {
      setOverrideOpen(true);
      return;
    }
    doSell();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.pharmacyPos', { defaultValue: 'Eczane Satış' })}
        description={t('pos.description', { defaultValue: 'Ürün ara, sepete ekle, tahsilat al.' })}
      />

      {/* #712 — reçeteye bağlı satış şeridi: hasta + reçete kalemleri (rehber). */}
      {rxId && rx && (
        <div className="flex items-start gap-3 rounded-lg border border-info-border bg-info-bg p-3">
          <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {t('pos.rxBound', { defaultValue: 'Reçeteye bağlı satış' })}
              {rx.patient && (
                <span className="ml-1 font-normal text-muted-foreground">
                  · {rx.patient.firstName} {rx.patient.lastName}
                  {rx.patient.mrn ? ` (${rx.patient.mrn})` : ''}
                </span>
              )}
            </div>
            {rxItems.length > 0 && (
              <div className="mt-2 space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  {t('pos.rxItems', { defaultValue: 'Reçete kalemleri' })} —{' '}
                  {t('pos.rxMapHint', {
                    defaultValue: 'her kalemi arayıp ürünü siz seçin (otomatik eşleme yok)',
                  })}
                </div>
                <ul className="space-y-1">
                  {rxItems.map((it, i) => {
                    const label = it.name ?? '—';
                    const dispensed = cart.some((l) => l.prescriptionItemLabel === label);
                    return (
                      <li
                        key={`${label}-${i}`}
                        className="flex items-center gap-2 rounded-lg bg-background/70 px-2 py-1 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {label}
                          {it.dose ? (
                            <span className="ml-1 text-xs text-muted-foreground">{it.dose}</span>
                          ) : null}
                        </span>
                        {dispensed && (
                          <span className="shrink-0 rounded-badge border border-success-border bg-success-bg px-1.5 py-0.5 text-[10px] font-medium text-success-foreground">
                            {t('pos.rxItemInCart', { defaultValue: 'sepette' })}
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant={activeRxLabel === label ? 'default' : 'outline'}
                          className="h-7 shrink-0 px-2"
                          onClick={() => startMapRxItem(label)}
                          data-testid={`rx-map-${i}`}
                        >
                          {t('pos.rxMap', { defaultValue: 'Ara & eşle' })}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                {activeRxLabel && (
                  <p className="text-xs text-warning-foreground">
                    {t('pos.rxMapping', {
                      label: activeRxLabel,
                      defaultValue: `"${activeRxLabel}" için ürün seçin → sepete eklenince eşlenir.`,
                    })}
                  </p>
                )}
                {/* Dispense durumu: eczacı dağıtımı bitirince işaretler (kısmi/tam). */}
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-muted-foreground">
                    {t('pos.rxDispenseMark', { defaultValue: 'Dağıtım:' })}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2"
                    disabled={markDispense.isPending}
                    onClick={() => markDispense.mutate({ id: rx.id, status: 'partial' })}
                  >
                    {t('pos.rxPartial', { defaultValue: 'Kısmi' })}
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 px-2"
                    disabled={markDispense.isPending}
                    onClick={() => markDispense.mutate({ id: rx.id, status: 'dispensed' })}
                  >
                    {t('pos.rxFull', { defaultValue: 'Tam dağıtıldı' })}
                  </Button>
                </div>
              </div>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={clearRx}>
            <X className="mr-1 h-3.5 w-3.5" />
            {t('pos.rxUnbind', { defaultValue: 'Bağı kaldır' })}
          </Button>
        </div>
      )}

      {/* R9 #731 — anonim walk-in satışta nötr "Alıcı" bağlamı (KVKK: kişisel veri yok).
          "müşteri/hasta" yerine nötr "Alıcı"; reçeteye bağlı satışta üstteki hasta şeridi çıkar. */}
      {!rxId && (
        <div
          className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3"
          data-testid="pos-buyer-anon"
        >
          <UserRound className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {t('pos.buyer', { defaultValue: 'Alıcı' })}:{' '}
              <span className="font-normal text-muted-foreground">
                {t('pos.buyerAnonymous', { defaultValue: 'Anonim satış · walk-in' })}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t('pos.buyerKvkk', { defaultValue: 'Kişisel veri kaydedilmez (KVKK).' })}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Ürün arama */}
        <section className="rounded-lg border bg-card">
          <div className="border-b p-3">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={t('pos.search', { defaultValue: 'Ürün / barkod ara' })}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          {/* R9 #731 — kategori hızlı filtre (foolproof: aramadan daha hızlı seçim). */}
          {categories.length > 0 && (
            <div
              className="flex flex-wrap gap-1.5 border-b p-2"
              role="group"
              aria-label={t('pos.categoryFilter', { defaultValue: 'Kategoriye göre filtrele' })}
            >
              {[null, ...categories].map((c) => {
                const on = activeCat === c;
                return (
                  <button
                    key={c ?? '__all__'}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setActiveCat(c)}
                    className={`h-8 rounded-lg border px-3 text-sm font-medium ${
                      on
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-field text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    {c ?? t('pos.allCategories', { defaultValue: 'Tümü' })}
                  </button>
                );
              })}
            </div>
          )}
          <ul className="max-h-[28rem] divide-y overflow-auto">
            {filtered.length === 0 && (
              <li className="p-4 text-center text-sm text-muted-foreground">
                {t('pos.noProducts', { defaultValue: 'Ürün bulunamadı.' })}
              </li>
            )}
            {filtered.map((p) => {
              const batch = pickBatch(p);
              const stock = p.batches.reduce((s, b) => s + b.availableQty, 0);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={!batch}
                    onClick={() => addToCart(p)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-muted/50 disabled:opacity-40"
                  >
                    <div>
                      <div className="flex items-center gap-1.5 font-medium">
                        {p.name}
                        {p.requiresPrescription && (
                          <span className="rounded-badge border border-warning-border bg-warning-bg px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning-foreground">
                            {t('pos.rxBadge', { defaultValue: 'Reçeteli' })}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.code} · {t('pos.stock', { defaultValue: 'stok' })} {stock}
                      </div>
                    </div>
                    <div className="tabular-nums text-sm">
                      {batch ? `${Number(batch.salePrice).toFixed(2)} TJS` : '—'}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Sepet */}
        <section className="flex flex-col rounded-lg border bg-card">
          <header className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
            <ShoppingCart className="h-4 w-4" />
            {t('pos.cart', { defaultValue: 'Sepet' })}
          </header>
          <div className="flex-1 divide-y overflow-auto">
            {cart.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {t('pos.emptyCart', { defaultValue: 'Sepet boş — ürün ekleyin.' })}
              </div>
            )}
            {cart.map((l) => (
              <div key={l.batchId} className="flex items-center gap-2 px-4 py-2">
                <div className="flex-1">
                  <div className="text-sm font-medium">{l.itemName}</div>
                  <div className="text-xs text-muted-foreground">
                    {l.unitPrice.toFixed(2)} × {l.quantity}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon-touch"
                    variant="ghost"
                    aria-label={t('pos.qtyMinus', { defaultValue: 'Adet azalt' })}
                    onClick={() => changeQty(l.batchId, -1)}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-8 text-center text-base tabular-nums">{l.quantity}</span>
                  <Button
                    size="icon-touch"
                    variant="ghost"
                    disabled={l.quantity >= l.maxQty}
                    aria-label={t('pos.qtyPlus', { defaultValue: 'Adet artır' })}
                    onClick={() => changeQty(l.batchId, 1)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="w-20 text-right tabular-nums text-sm">
                  {(l.quantity * l.unitPrice).toFixed(2)}
                </div>
                <Button
                  size="icon-touch"
                  variant="ghost"
                  aria-label={t('pos.removeItem', { defaultValue: 'Kalemi çıkar' })}
                  onClick={() => setCart((prev) => prev.filter((x) => x.batchId !== l.batchId))}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
          <footer className="space-y-3 border-t p-4">
            <div>
              <Label>{t('pos.payment', { defaultValue: 'Ödeme' })}</Label>
              <select
                className="focus-ring h-10 w-full rounded-lg border border-field bg-background px-3 text-sm hover:border-field-hover"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              >
                <option value="cash">{t('pos.method.cash', { defaultValue: 'Nakit' })}</option>
                <option value="card">{t('pos.method.card', { defaultValue: 'Kart' })}</option>
                <option value="transfer">
                  {t('pos.method.transfer', { defaultValue: 'Havale' })}
                </option>
              </select>
            </div>
            {/* #714 (L) — indirim alanı (backend zaten destekliyordu, UI'da sabit 0'dı). */}
            <div>
              <Label htmlFor="pos-discount">{t('pos.discount', { defaultValue: 'İndirim' })}</Label>
              <Input
                id="pos-discount"
                type="number"
                min={0}
                max={subtotal}
                value={discount === 0 ? '' : discount}
                placeholder="0"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDiscount(Number.isFinite(v) ? Math.max(0, Math.min(subtotal, v)) : 0);
                }}
              />
            </div>
            {discount > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('pos.subtotal', { defaultValue: 'Ara toplam' })}</span>
                <span className="tabular-nums">{subtotal.toFixed(2)} TJS</span>
              </div>
            )}
            <div className="flex items-center justify-between text-lg font-semibold">
              <span>{t('pos.total', { defaultValue: 'Toplam' })}</span>
              <span className="tabular-nums">{total.toFixed(2)} TJS</span>
            </div>
            {/* Karar 9 — >%10 indirim: tahsilatta süpervizör onayı gerekir. */}
            {needsOverride && (
              <p className="flex items-center gap-1.5 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-foreground">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t('pos.discountCapHint', {
                  defaultValue:
                    "İndirim %10'u aşıyor — tahsilatta süpervizör (yönetici/finans) onayı gerekir.",
                })}
              </p>
            )}
            {/* #711 — reçeteli ürün var ama reçete bağı yok → satış engelli + uyarı. */}
            {rxBlocked && (
              <p className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-foreground">
                {t('pos.rxRequiredHint', {
                  defaultValue:
                    'Sepette reçeteli ürün var. Reçete Kuyruğundan açın ya da reçete bağlayın; anonim satış kapalı.',
                })}
              </p>
            )}
            <Button
              className="w-full"
              size="lg"
              disabled={cart.length === 0 || sell.isPending || rxBlocked}
              onClick={checkout}
            >
              {t('pos.checkout', { defaultValue: 'Tahsilat Al' })}
            </Button>
          </footer>
        </section>
      </div>

      {/* Karar 9 — Süpervizör onay dialog'u: >%10 indirim için yönetici/finans giriş yapar. */}
      <Dialog open={overrideOpen} onOpenChange={(o) => !sell.isPending && setOverrideOpen(o)}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-warning-foreground" aria-hidden />
            {t('pos.overrideTitle', { defaultValue: 'Süpervizör Onayı' })}
          </DialogTitle>
          <DialogDescription>
            {t('pos.overrideHint', {
              defaultValue:
                '%10 üstü indirim için yönetici veya finans yetkilisi e-posta + şifre girmeli.',
            })}
          </DialogDescription>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ovEmail || !ovPassword || sell.isPending) return;
              doSell({ email: ovEmail, password: ovPassword });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="ov-email">
                {t('pos.overrideEmail', { defaultValue: 'E-posta' })}
              </Label>
              <Input
                id="ov-email"
                type="email"
                autoComplete="off"
                value={ovEmail}
                onChange={(e) => setOvEmail(e.target.value)}
                data-testid="pos-override-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ov-password">
                {t('pos.overridePassword', { defaultValue: 'Şifre' })}
              </Label>
              <Input
                id="ov-password"
                type="password"
                autoComplete="off"
                value={ovPassword}
                onChange={(e) => setOvPassword(e.target.value)}
                data-testid="pos-override-password"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="touch"
                disabled={sell.isPending}
                onClick={() => setOverrideOpen(false)}
              >
                {t('pos.overrideCancel', { defaultValue: 'İptal' })}
              </Button>
              <Button
                type="submit"
                size="touch"
                disabled={sell.isPending || !ovEmail || !ovPassword}
                data-testid="pos-override-submit"
              >
                {t('pos.overrideSubmit', { defaultValue: 'Onayla & Tahsil Et' })}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
