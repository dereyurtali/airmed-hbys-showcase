import { localeToIntl } from '../../lib/i18n-format';
import { useMemo, useState } from 'react';
import { Plus, QrCode, Send, Store, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { PrescriptionForm } from './PrescriptionForm';
import { PrescriptionQrModal } from './PrescriptionQrModal';
import { buildQrPayload, type PrescriptionType } from '../../lib/pharmacy.constants';
import { trpc } from '../../lib/trpc';
import { usePermissions } from '../../hooks/usePermission';
import { useLocale } from '../../providers/LocaleProvider';

interface Props {
  patientId: string;
}

interface PrescriptionRow {
  id: string;
  type: PrescriptionType;
  items: unknown[];
  notes: string | null;
  sentAt: string | Date | null;
  createdAt: string | Date;
  createdById: string | null;
  supplier: { id: string; name: string; category: string } | null;
  createdBy: { id: string; name: string } | null;
}

export function PrescriptionsSection({ patientId }: Props) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';
  const utils = trpc.useUtils();

  // Delta audit A-5: hardcoded role-array `.includes(r)` pattern'i kaldırıldı,
  // permission registry kullanılır. `isAdmin` tek role kalın — P2 takip.
  const perms = usePermissions(['action:prescription.create', 'action:prescription.update']);
  const canEdit = perms['action:prescription.create'] || perms['action:prescription.update'];
  const me = trpc.auth.me.useQuery();
  const isAdmin = (me.data?.roles ?? []).includes('yonetici');
  const myUserId = me.data?.sub;

  const list = trpc.pharmacy.listPrescriptions.useQuery({ patientId });
  const suppliers = trpc.pharmacy.listSuppliers.useQuery({ includeInactive: false });

  const [formOpen, setFormOpen] = useState(false);
  const [qr, setQr] = useState<{
    payload: string;
    rxId: string;
    supplierName: string | null;
  } | null>(null);

  const handleError = (err: unknown) => {
    const msg = err instanceof TRPCClientError ? err.message : t('pharmacy:errors.unknown');
    toast.error(msg);
  };

  const send = trpc.pharmacy.sendPrescription.useMutation({
    onSuccess: async () => {
      toast.success(t('pharmacy:toast.sent'));
      await utils.pharmacy.listPrescriptions.invalidate({ patientId });
    },
    onError: handleError,
  });

  // #712 — Reçeteyi İÇ eczane POS kuyruğuna gönder (supplier'sız ilaç reçetesi).
  const dispense = trpc.pharmacy.dispenseToPharmacy.useMutation({
    onSuccess: async () => {
      toast.success(
        t('pharmacy:toast.dispensed', { defaultValue: 'İç eczane kuyruğuna gönderildi' }),
      );
      await utils.pharmacy.listPrescriptions.invalidate({ patientId });
    },
    onError: handleError,
  });

  const del = trpc.pharmacy.softDeletePrescription.useMutation({
    onSuccess: async () => {
      toast.success(t('pharmacy:toast.deleted'));
      await utils.pharmacy.listPrescriptions.invalidate({ patientId });
    },
    onError: handleError,
  });
  // #406 — reçete silme geri-alınamaz; tek-tık yerine teyit ister.
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fmtDate = (d: string | Date) => {
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleDateString(dateLocale);
  };

  const items = useMemo(() => (list.data as PrescriptionRow[] | undefined) ?? [], [list.data]);

  const isOwner = (rx: PrescriptionRow) => isAdmin || rx.createdById === myUserId;

  const showQr = (rx: PrescriptionRow) => {
    // Patient bilgilerini sadece QR payload için minimal context lazım — backend
    // findById üzerinden tam bilgi alıp gösterilebilir; v1'de listede yok, basit
    // payload: tip + items + supplier name. Hasta MRN frontend'de var değil burada.
    setQr({
      payload: buildQrPayload({
        id: rx.id,
        type: rx.type,
        patient: { mrn: '', firstName: '', lastName: '' },
        supplier: rx.supplier,
        items: rx.items,
        notes: rx.notes,
        createdAt: rx.createdAt,
      }),
      rxId: rx.id,
      supplierName: rx.supplier?.name ?? null,
    });
  };

  return (
    <section className="space-y-3" aria-labelledby="rx-heading">
      <header className="flex items-center justify-between">
        <h2 id="rx-heading" className="text-lg font-semibold">
          {t('pharmacy:section.title')}
        </h2>
        {canEdit && (
          <Button size="sm" onClick={() => setFormOpen(true)} data-testid="rx-new">
            <Plus className="mr-1 h-4 w-4" />
            {t('pharmacy:section.new')}
          </Button>
        )}
      </header>

      <div className="rounded-md border bg-background">
        {list.isLoading && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t('common:actions.loading')}
          </p>
        )}
        {!list.isLoading && items.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t('pharmacy:section.empty')}
          </p>
        )}
        {items.length > 0 && (
          <ul className="divide-y">
            {items.map((rx) => {
              const sent = rx.sentAt !== null;
              return (
                <li key={rx.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">
                        {t(`pharmacy:type.${rx.type}`)} ·{' '}
                        <span className="text-xs text-muted-foreground">
                          {rx.supplier?.name ?? t('pharmacy:rxForm.noSupplier')}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(rx.createdAt)} · {rx.createdBy?.name ?? '—'} ·{' '}
                        {sent
                          ? t('pharmacy:status.sent', { date: fmtDate(rx.sentAt as string) })
                          : t('pharmacy:status.draft')}
                      </div>
                      {rx.notes && <p className="mt-1 text-xs">{rx.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      {sent && (
                        <Button size="sm" variant="ghost" onClick={() => showQr(rx)}>
                          <QrCode className="mr-1 h-3.5 w-3.5" />
                          {t('pharmacy:actions.viewQr')}
                        </Button>
                      )}
                      {!sent && isOwner(rx) && rx.supplier && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            send.mutate({ id: rx.id }, { onSuccess: () => showQr(rx) });
                          }}
                          disabled={send.isPending}
                        >
                          <Send className="mr-1 h-3.5 w-3.5" />
                          {t('pharmacy:actions.send')}
                        </Button>
                      )}
                      {/* #712 — supplier'sız ilaç reçetesi → iç eczane POS kuyruğu. */}
                      {!sent && isOwner(rx) && !rx.supplier && rx.type === 'drug' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => dispense.mutate({ id: rx.id })}
                          disabled={dispense.isPending}
                        >
                          <Store className="mr-1 h-3.5 w-3.5" />
                          {t('pharmacy:actions.dispenseInHouse', {
                            defaultValue: 'İç eczaneye gönder',
                          })}
                        </Button>
                      )}
                      {!sent && isOwner(rx) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteId(rx.id)}
                          aria-label={t('common:actions.delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <PrescriptionForm
        open={formOpen}
        onOpenChange={setFormOpen}
        patientId={patientId}
        suppliers={(suppliers.data ?? []) as { id: string; name: string; category: string }[]}
        onSaved={() => setFormOpen(false)}
      />

      <PrescriptionQrModal
        open={qr !== null}
        onOpenChange={(o) => !o && setQr(null)}
        payload={qr?.payload ?? ''}
        rxId={qr?.rxId ?? ''}
        supplierName={qr?.supplierName ?? null}
      />
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title={t('common:actions.delete')}
        description={t('common:actions.confirmIrreversible')}
        pending={del.isPending}
        onConfirm={() => {
          if (deleteId) del.mutate({ id: deleteId });
          setDeleteId(null);
        }}
      />
    </section>
  );
}
