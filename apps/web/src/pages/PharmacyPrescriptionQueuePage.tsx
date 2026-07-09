import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { trpc } from '../lib/trpc';

// v0.4 #554 — Reçete Kuyruğu (eczane görünümü). Doktorun gönderdiği ilaç
// reçeteleri düşer; eczacı POS'ta satışa çevirir. Liste #552'de.

interface Rx {
  id: string;
  sentAt: string | null;
  items: unknown;
  // #790 — kısmi dağıtılmış reçeteler kuyrukta kalır; rozetle ayırt edilir.
  dispenseStatus?: 'pending' | 'partial' | 'dispensed';
  patient: { firstName: string; lastName: string; mrn: string | null } | null;
}

export function PharmacyPrescriptionQueuePage() {
  const { t } = useTranslation(['common']);
  const navigate = useNavigate();
  const listQuery = trpc.pharmacyRetail.dispensablePrescriptions.useQuery();
  const rows = (listQuery.data ?? []) as unknown as Rx[];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.pharmacyPrescriptions', { defaultValue: 'Reçete Kuyruğu' })}
        description={t('rxQueue.description', {
          defaultValue: 'Doktorun gönderdiği ilaç reçeteleri. Satışa çevirin.',
        })}
      />
      <section className="rounded-lg border bg-card">
        <header className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
          <ClipboardList className="h-4 w-4" />
          {t('rxQueue.title', { defaultValue: 'Bekleyen Reçeteler' })}
        </header>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('rxQueue.colPatient', { defaultValue: 'Hasta' })}</TableHead>
              <TableHead className="text-right">
                {t('rxQueue.colItems', { defaultValue: 'Kalem' })}
              </TableHead>
              <TableHead>{t('rxQueue.colSent', { defaultValue: 'Gönderim' })}</TableHead>
              <TableHead className="text-right">
                {t('rxQueue.colActions', { defaultValue: 'İşlem' })}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  {t('rxQueue.empty', { defaultValue: 'Bekleyen reçete yok.' })}
                </TableCell>
              </TableRow>
            )}
            {rows.map((rx) => {
              const count = Array.isArray(rx.items) ? rx.items.length : 0;
              return (
                <TableRow key={rx.id}>
                  <TableCell>
                    {/* v0.4.2 R9 (KVKK) — eczane kuyruğu yarı-açık alan: soyadı baş-harfe
                        maskelenir; kimlik MRN ile doğrulanır (tam ad ifşa edilmez). */}
                    <div className="flex items-center gap-2 font-medium">
                      {rx.patient
                        ? `${rx.patient.firstName} ${rx.patient.lastName.charAt(0)}.`
                        : '—'}
                      {rx.dispenseStatus === 'partial' && (
                        <span className="rounded-badge border border-warning-border bg-warning-bg px-1.5 py-0.5 text-[10px] font-medium text-warning-foreground">
                          {t('rxQueue.partial', { defaultValue: 'Kısmi' })}
                        </span>
                      )}
                    </div>
                    {rx.patient?.mrn && (
                      <div className="text-xs text-muted-foreground">{rx.patient.mrn}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{count}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {rx.sentAt ? new Date(rx.sentAt).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {/* #712 — reçete id'sini POS'a taşı: POS hasta+reçeteye bağlı
                        açılır (prescriptionId + isAnonymous=false), kalemler rehber. */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/pharmacy/pos?rx=${rx.id}`)}
                    >
                      {t('rxQueue.toPos', { defaultValue: "POS'ta aç" })}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
