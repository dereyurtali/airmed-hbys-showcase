import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Badge, type BadgeProps } from '../ui/badge';

// #906 — Klinik (IOL) ve Eczane stok hareket ekranları birebir aynı tabloyu iki
// kez yazıyordu (BackBar+PageHeader sayfalarda kalır; tablo iskeleti buraya
// çıkarıldı). Sayfa kendi tRPC verisini `MovementRow[]`'e normalize eder + i18n
// prefix ve tip→Badge variant (tone-map) verir. Badge variant'ları eczanenin
// eski tint span'leriyle birebir aynı token → görsel regression yok.

export interface MovementRow {
  id: string;
  createdAt: string | Date;
  /** Hareket tipi anahtarı (receive/intake/…); etiket `${i18nPrefix}.type.<type>`. */
  type: string;
  /** İşaretli miktar (+ giriş / − çıkış). */
  quantity: number;
  /** Birincil ürün adı (ör. lens markası+modeli veya eczane ürün adı). */
  itemPrimary: string;
  /** İkincil satır (ör. lot no · diyoptri, ya da ürün kodu · parti). */
  itemSecondary?: string | null;
  userName?: string | null;
  notes?: string | null;
}

export interface MovementsTableProps {
  rows: readonly MovementRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /** `common` altındaki i18n prefix — 'stockMovements' | 'pharmacyMovements'. */
  i18nPrefix: string;
  /** Hareket tipi → Badge variant (tone-map). Eşleşmeyen tip 'neutral'. */
  typeVariant: Record<string, BadgeProps['variant']>;
}

export function MovementsTable({
  rows,
  isLoading,
  isError,
  i18nPrefix: p,
  typeVariant,
}: MovementsTableProps) {
  const { t } = useTranslation('common');
  const isEmpty = !isLoading && !isError && rows?.length === 0;

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(`${p}.colDate`)}</TableHead>
            <TableHead>{t(`${p}.colType`)}</TableHead>
            <TableHead>{t(`${p}.colItem`)}</TableHead>
            <TableHead className="text-right">{t(`${p}.colQty`)}</TableHead>
            <TableHead>{t(`${p}.colUser`)}</TableHead>
            <TableHead>{t(`${p}.colNote`)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                {t('loading', { defaultValue: 'Yükleniyor…' })}
              </TableCell>
            </TableRow>
          )}
          {isError && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-destructive">
                {t(`${p}.error`)}
              </TableCell>
            </TableRow>
          )}
          {isEmpty && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                {t(`${p}.empty`)}
              </TableCell>
            </TableRow>
          )}
          {rows?.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="whitespace-nowrap text-sm">
                {new Date(m.createdAt).toLocaleString()}
              </TableCell>
              <TableCell>
                <Badge variant={typeVariant[m.type] ?? 'neutral'}>
                  {t(`${p}.type.${m.type}`, { defaultValue: m.type })}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="font-medium">{m.itemPrimary}</div>
                {m.itemSecondary && (
                  <div className="text-xs text-muted-foreground">{m.itemSecondary}</div>
                )}
              </TableCell>
              <TableCell
                className={`text-right font-medium tabular-nums ${
                  m.quantity < 0 ? 'text-critical-foreground' : 'text-success-foreground'
                }`}
              >
                {m.quantity > 0 ? '+' : ''}
                {m.quantity}
              </TableCell>
              <TableCell className="text-sm">{m.userName ?? '—'}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{m.notes ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
