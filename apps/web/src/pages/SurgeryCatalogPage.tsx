import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { localeToIntl } from '../lib/i18n-format';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatCurrency } from '../lib/commission.constants';
import {
  SURGERY_CATALOG_CURRENCY,
  surgeryMeta,
  localizedServiceName,
} from '../lib/surgery-catalog';
import { billingApi, type ServiceItemRow } from '../lib/billing.trpc';
import { useLocale } from '../providers/LocaleProvider';

/**
 * S16 + #362 — Ameliyat Kataloğu: cerrahi paketler kategoriye göre gruplu (Katarakt /
 * Refraktif / Glokom / Retina / Ön Segment). Salt-okunur referans; paket + lens/yöntem +
 * malzeme + katalog fiyatı. Kaynak: DB ServiceItem (category='surgery') — fiyat/isim
 * yönetici ekranından düzenlenir, 3 dil + tenant-bazlı.
 */
export function SurgeryCatalogPage() {
  const { t } = useTranslation('surgerySales');
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';

  const query = billingApi.listServiceItems.useQuery({
    category: 'surgery',
    includeInactive: false,
  });
  const items = useMemo(() => query.data ?? [], [query.data]);

  const [search, setSearch] = useState('');
  const q = search.trim().toLocaleLowerCase(dateLocale);

  // metadata.surgeryGroup'a göre grupla; grup sırası ilk görülen sortOrder'a göre.
  const groups = useMemo(() => {
    const byGroup = new Map<string, ServiceItemRow[]>();
    for (const item of items) {
      const name = localizedServiceName(item, locale);
      const lens = surgeryMeta(item).lens ?? '';
      if (
        q &&
        !name.toLocaleLowerCase(dateLocale).includes(q) &&
        !lens.toLocaleLowerCase(dateLocale).includes(q)
      ) {
        continue;
      }
      const group = surgeryMeta(item).surgeryGroup || t('catalog.ungrouped');
      const list = byGroup.get(group) ?? [];
      list.push(item);
      byGroup.set(group, list);
    }
    return Array.from(byGroup.entries()).map(([group, list]) => ({ group, items: list }));
  }, [items, q, dateLocale, locale, t]);

  const fmt = (n: string) => formatCurrency(Number(n), SURGERY_CATALOG_CURRENCY, dateLocale);
  const dateLabel = new Date().toLocaleDateString(dateLocale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('catalog.title')}</h1>
          <p className="text-sm capitalize text-muted-foreground">{dateLabel}</p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('catalog.searchPlaceholder')}
            className="h-10 w-full rounded-full border border-input bg-muted/40 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {query.isLoading && (
          <div className="rounded-2xl border bg-background py-16 text-center text-sm text-muted-foreground">
            {t('catalog.loading')}
          </div>
        )}
        {query.error && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/5 py-16 text-center text-sm text-destructive">
            {query.error.message}
          </div>
        )}
        {!query.isLoading && !query.error && groups.length === 0 && (
          <div className="rounded-2xl border bg-background py-16 text-center text-sm text-muted-foreground">
            {t('catalog.empty')}
          </div>
        )}
        {groups.map((g) => (
          <section key={g.group} className="overflow-hidden rounded-2xl border bg-background">
            <h2 className="px-5 py-4 text-lg font-semibold">{g.group}</h2>
            <div className="overflow-x-auto border-t">
              <Table className="w-full">
                <TableHeader>
                  <TableRow className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <TableHead className="px-5 py-3 font-medium">
                      {t('catalog.col.paket')}
                    </TableHead>
                    <TableHead className="py-3 font-medium">{t('catalog.col.lens')}</TableHead>
                    <TableHead className="py-3 font-medium">{t('catalog.col.material')}</TableHead>
                    <TableHead className="px-5 py-3 text-right font-medium">
                      {t('catalog.col.price')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.items.map((item) => {
                    const meta = surgeryMeta(item);
                    const materials = meta.materials ?? [];
                    return (
                      <TableRow key={item.id} className="border-t align-middle">
                        <TableCell className="px-5 py-3 text-sm font-medium">
                          {localizedServiceName(item, locale)}
                        </TableCell>
                        <TableCell className="py-3">
                          {meta.lens ? (
                            <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                              {meta.lens}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-3 text-sm text-muted-foreground">
                          {materials.length > 0 ? materials.join(', ') : '—'}
                        </TableCell>
                        <TableCell
                          className={cn('px-5 py-3 text-right text-sm font-semibold tabular-nums')}
                        >
                          {fmt(item.defaultPrice)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
