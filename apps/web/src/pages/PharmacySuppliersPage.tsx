import { useTranslation } from 'react-i18next';
import { BackBar } from '../components/layout/BackBar';
import { PageHeader } from '../components/layout/PageHeader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { trpc } from '../lib/trpc';

// v0.4.1 (#693) — Eczane Tedarikçileri. Eczane partilerine (PharmacyBatch) tedarik
// yapmış tedarikçiler + parti/ürün sayısı. Eczaneye özel ayrı supplier modeli yok;
// genel Supplier üzerinden pharmacy batch ilişkisinden türetilir (salt-okunur).

/** Eczane Tedarikçileri — partilerden türetilmiş tedarikçi listesi (salt-okunur). */
export function PharmacySuppliersPage() {
  const { t } = useTranslation('common');
  const { data, isLoading, error } = trpc.pharmacyRetail.suppliers.useQuery();

  return (
    <div className="space-y-4">
      <BackBar />
      <PageHeader
        title={t('pharmacySuppliers.title', { defaultValue: 'Eczane Tedarikçileri' })}
        description={t('pharmacySuppliers.description', {
          defaultValue: 'Eczane stoğuna parti tedarik etmiş tedarikçiler.',
        })}
      />
      <div className="overflow-hidden rounded-xl border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pharmacySuppliers.colName', { defaultValue: 'Tedarikçi' })}</TableHead>
              <TableHead>{t('pharmacySuppliers.colPhone', { defaultValue: 'Telefon' })}</TableHead>
              <TableHead>{t('pharmacySuppliers.colEmail', { defaultValue: 'E-posta' })}</TableHead>
              <TableHead className="text-right">
                {t('pharmacySuppliers.colBatches', { defaultValue: 'Parti' })}
              </TableHead>
              <TableHead className="text-right">
                {t('pharmacySuppliers.colProducts', { defaultValue: 'Ürün' })}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {t('loading', { defaultValue: 'Yükleniyor…' })}
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-destructive">
                  {t('pharmacySuppliers.error', { defaultValue: 'Tedarikçiler yüklenemedi.' })}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {t('pharmacySuppliers.empty', {
                    defaultValue: 'Henüz partiye bağlı tedarikçi yok.',
                  })}
                </TableCell>
              </TableRow>
            )}
            {data?.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {s.contactPhone ?? '—'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {s.contactEmail ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{s.batchCount}</TableCell>
                <TableCell className="text-right tabular-nums">{s.productCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
