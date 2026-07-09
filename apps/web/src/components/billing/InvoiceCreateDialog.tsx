import { localeToIntl } from '../../lib/i18n-format';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import {
  CURRENCIES,
  formatMoney,
  pickDefaultServiceItem,
  type Currency,
} from '../../lib/billing.constants';
import {
  serviceCategoryForAppointmentType,
  type AppointmentType,
} from '../../lib/appointment.constants';
import { billingApi, type InvoiceRow, type ServiceItemRow } from '../../lib/billing.trpc';
import { trpc } from '../../lib/trpc';
import { useLocale } from '../../providers/LocaleProvider';
import { PatientCommandPicker, type SelectedPatient } from '../schedule/PatientCommandPicker';
import { useUnsavedWarning, confirmIfDirty } from '../../hooks/useUnsavedWarning';

interface ItemDraft {
  serviceItemId: string | null;
  description: string;
  quantity: number;
  unitPrice: string;
}

interface Props {
  patientId?: string; // Hasta detayından açılırsa hasta sabit
  // v0.4.2 Karar 4 — resepsiyon check-in zincirinden açılırsa randevu bilgisi gelir:
  // randevu tipine göre ilk kalem otomatik ön-doldurulur (düzenlenebilir) ve fatura
  // randevuya bağlanır.
  appointmentId?: string;
  appointmentType?: AppointmentType;
  onClose: () => void;
  onCreated: (invoice: InvoiceRow) => void;
}

const looseInvoice = billingApi.createInvoice as unknown as {
  useMutation: (opts?: {
    onSuccess?: (data: InvoiceRow) => void;
    onError?: (err: { message: string }) => void;
  }) => {
    mutate: (input: unknown) => void;
    isPending: boolean;
  };
};

export function InvoiceCreateDialog({
  patientId,
  appointmentId,
  appointmentType,
  onClose,
  onCreated,
}: Props) {
  const { t } = useTranslation(['billing', 'common']);
  const { locale } = useLocale();

  // Hasta detayından açılırsa patientId sabit; aksi halde global picker.
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatient | null>(null);
  const effectivePatientId = patientId ?? selectedPatient?.id ?? '';
  const [currency, setCurrency] = useState<Currency>('TJS');
  const [discount, setDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([
    { serviceItemId: null, description: '', quantity: 1, unitPrice: '0' },
  ]);

  const serviceList = billingApi.listServiceItems.useQuery({ includeInactive: false });

  const createMutation = looseInvoice.useMutation({
    onSuccess: (data) => onCreated(data),
    onError: (err) => toast.error(err.message ?? 'Hata'),
  });

  // v0.4.2 Karar 4 (#725) — check-in zincirinden gelen randevu tipine göre ilk kalemi
  // BİR KEZ otomatik doldur (kategorinin "tek default" ServiceItem'ı). Resepsiyon sonra
  // düzenleyebilir. Kategoride aktif kalem yoksa sessizce atla (manuel girilir).
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || !appointmentType) return;
    const list = serviceList.data;
    if (!list) return;
    prefilledRef.current = true;
    const item = pickDefaultServiceItem(list, serviceCategoryForAppointmentType(appointmentType));
    if (!item) return;
    setCurrency(item.defaultCurrency as Currency);
    setItems([
      { serviceItemId: item.id, description: item.name, quantity: 1, unitPrice: item.defaultPrice },
    ]);
  }, [appointmentType, serviceList.data]);

  // SİS-8 — Dolu faturada yanlışlıkla ESC/kapat veri kaybını uyarır. Başlangıç
  // = boş tek kalem + sıfır indirim + not yok + (patientId yoksa) hasta seçilmemiş.
  const dirty =
    !!selectedPatient ||
    discount !== '0' ||
    notes !== '' ||
    currency !== 'TJS' ||
    items.length !== 1 ||
    items.some(
      (it) =>
        it.serviceItemId !== null ||
        it.description !== '' ||
        it.quantity !== 1 ||
        it.unitPrice !== '0',
    );
  useUnsavedWarning(dirty);
  const requestClose = useCallback(() => {
    if (dirty && !confirmIfDirty(true, t('common:forms.unsavedConfirm'))) return;
    onClose();
  }, [dirty, onClose, t]);

  // Radix kapatma (ESC / dış tık / X) — dolu faturada teyit ister.
  const handleOpenChange = (next: boolean) => {
    if (!next) requestClose();
  };

  // #361 — Serbest indirim girişi mutlak tavanla sınırlanır (onayla bile
  // aşılamaz). Cap yüzde; tutar limiti = subtotal × cap%. Backend de zorlar.
  const limits = trpc.approval.myLimits.useQuery();
  const absoluteCap = limits.data?.absoluteMaxPercent ?? 30;

  const subtotal = items.reduce(
    (sum, it) => sum + parseFloat(it.unitPrice || '0') * it.quantity,
    0,
  );
  const maxDiscountAmount = subtotal > 0 ? Math.floor((subtotal * absoluteCap) / 100) : 0;
  const discountOverCap = subtotal > 0 && parseFloat(discount || '0') > maxDiscountAmount;
  const total = Math.max(0, subtotal - parseFloat(discount || '0'));

  const onPickServiceItem = (idx: number, serviceItemId: string) => {
    const item = serviceList.data?.find((s: ServiceItemRow) => s.id === serviceItemId);
    if (!item) return;
    // Para birimi koruması: bir fatura tek para birimidir. Katalog kaleminin
    // para birimi faturadan farklıysa, fiyatı sessizce kopyalayıp yanlış birimde
    // faturalama (USD hizmet → TJS tutar) olmasın. İlk katalog kalemi para
    // birimini belirler; sonraki farklı-birim kalem reddedilir.
    const itemCurrency = item.defaultCurrency as Currency;
    if (itemCurrency !== currency) {
      const hasOtherCatalogItem = items.some((it, i) => i !== idx && it.serviceItemId);
      if (hasOtherCatalogItem) {
        toast.error(t('billing:invoice.currencyMismatch'));
        return;
      }
      setCurrency(itemCurrency);
      toast.info(t('billing:invoice.currencyAutoSet', { currency: itemCurrency }));
    }
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx
          ? {
              serviceItemId: item.id,
              description: item.name,
              quantity: 1,
              unitPrice: item.defaultPrice,
            }
          : it,
      ),
    );
  };

  const onSubmit = () => {
    if (!effectivePatientId) {
      toast.error(t('billing:invoice.selectPatient'));
      return;
    }
    if (
      items.length === 0 ||
      items.some((it) => !it.description || parseFloat(it.unitPrice) <= 0)
    ) {
      toast.error(t('billing:invoice.itemsInvalid'));
      return;
    }
    if (discountOverCap) {
      toast.error(t('billing:invoice.discountOverCap', { percent: absoluteCap }));
      return;
    }
    createMutation.mutate({
      patientId: effectivePatientId,
      currency,
      discount,
      notes: notes || null,
      ...(appointmentId ? { appointmentId } : {}), // Karar 4 — check-in faturasını randevuya bağla
      items: items.map((it) => ({
        serviceItemId: it.serviceItemId,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
      })),
    });
  };

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
        <DialogTitle className="mb-4 text-xl">{t('billing:invoice.saveTitle')}</DialogTitle>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {/* Hasta seçimi — cmdk tabanlı global picker, MRN + isim aramayı destekler. */}
          {!patientId && (
            <div className="mb-4 space-y-2">
              <Label>{t('billing:invoice.patient')}</Label>
              <PatientCommandPicker selected={selectedPatient} onSelect={setSelectedPatient} />
            </div>
          )}

          {/* Currency */}
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('billing:invoice.currency')}</Label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t('billing:invoice.discount')}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max={maxDiscountAmount || undefined}
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                aria-invalid={discountOverCap}
                className={discountOverCap ? 'border-destructive' : undefined}
              />
              {discountOverCap ? (
                <p className="text-xs text-destructive">
                  {t('billing:invoice.discountOverCap', { percent: absoluteCap })}
                </p>
              ) : (
                subtotal > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('billing:invoice.discountCapHint', { percent: absoluteCap })}
                  </p>
                )
              )}
            </div>
          </div>

          {/* Items */}
          <div className="mb-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label>{t('billing:invoice.items')}</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setItems((prev) => [
                    ...prev,
                    { serviceItemId: null, description: '', quantity: 1, unitPrice: '0' },
                  ])
                }
              >
                <Plus className="mr-1 h-3 w-3" />
                {t('billing:invoice.addItem')}
              </Button>
            </div>

            {items.map((item, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 items-end gap-2 rounded-md border border-muted p-3"
              >
                <div className="col-span-12">
                  <select
                    value={item.serviceItemId ?? ''}
                    onChange={(e) =>
                      e.target.value
                        ? onPickServiceItem(idx, e.target.value)
                        : setItems((prev) =>
                            prev.map((it, i) => (i === idx ? { ...it, serviceItemId: null } : it)),
                          )
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="">{t('billing:invoice.fromCatalog')}…</option>
                    {(serviceList.data ?? []).map((svc: ServiceItemRow) => (
                      <option key={svc.id} value={svc.id}>
                        {svc.code} — {svc.name} ({svc.defaultPrice} {svc.defaultCurrency})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-6">
                  <Input
                    placeholder={t('billing:invoice.description')}
                    value={item.description}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((it, i) =>
                          i === idx ? { ...it, description: e.target.value } : it,
                        ),
                      )
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    min={1}
                    placeholder={t('billing:invoice.quantity')}
                    value={item.quantity}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((it, i) =>
                          i === idx ? { ...it, quantity: parseInt(e.target.value) || 1 } : it,
                        ),
                      )
                    }
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    placeholder={t('billing:invoice.unitPrice')}
                    value={item.unitPrice}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((it, i) =>
                          i === idx ? { ...it, unitPrice: e.target.value } : it,
                        ),
                      )
                    }
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="rounded-md p-2 text-destructive hover:bg-destructive/10"
                    aria-label="Sil"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div className="mb-4 space-y-2">
            <Label>{t('billing:invoice.notes')}</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Totals */}
          <div className="mb-4 grid grid-cols-3 gap-3 rounded-md bg-muted/30 p-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">{t('billing:invoice.subtotal')}</div>
              <div className="font-medium">
                {formatMoney(subtotal, currency, localeToIntl(locale))}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('billing:invoice.discount')}</div>
              <div className="font-medium">
                {formatMoney(discount || '0', currency, localeToIntl(locale))}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('billing:invoice.total')}</div>
              <div className="text-lg font-semibold">
                {formatMoney(total, currency, localeToIntl(locale))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={requestClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={createMutation.isPending || discountOverCap}>
              {t('billing:invoice.saveSubmit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
