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
import { ArrowRightLeft, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { EmptyState } from '../components/ui/empty-state';
import { IolModelForm, type ExistingIolModel } from '../components/iol/IolModelForm';
import { IolLotForm, type ExistingIolLot } from '../components/iol/IolLotForm';
import { IolMovementDialog } from '../components/iol/IolMovementDialog';
import { SurgicalKitsSection } from '../components/iol/SurgicalKitsSection';
import { EXPIRY_WARNING_DAYS, daysUntil, expiryBadge, stockBadge } from '../lib/iol.constants';
import { usePermission } from '../hooks/usePermission';
import { trpc } from '../lib/trpc';
import { useLocale } from '../providers/LocaleProvider';
import { DataErrorState } from '../components/common/DataErrorState';

interface ModelRow {
  id: string;
  brand: string;
  model: string;
  description: string | null;
  isActive: boolean;
  lensType: string;
  minQty: number;
  _count: { lots: number };
}

interface LotRow {
  id: string;
  modelId: string;
  lotNumber: string;
  power: string | number;
  quantity: number;
  // #401 — 3-state stok: rezerve lens 'mevcut' görünmesin diye Müsait/Rezerve ayrı.
  availableQty: number;
  reservedQty: number;
  expiresAt: string | Date;
  supplier: string | null;
  notes: string | null;
  model: { id: string; brand: string; model: string };
}

export function IolInventoryPage() {
  const { t } = useTranslation(['iol', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';

  // S10a — Permission registry (P1 #3.31): hardcode role check kaldırıldı.
  const canManage = usePermission('action:iol.lotCreate');

  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [modelDialog, setModelDialog] = useState<{
    open: boolean;
    existing: ExistingIolModel | null;
  }>({
    open: false,
    existing: null,
  });
  const [lotDialog, setLotDialog] = useState<{
    open: boolean;
    modelId: string;
    existing: ExistingIolLot | null;
  }>({
    open: false,
    modelId: '',
    existing: null,
  });
  const [movementDialog, setMovementDialog] = useState<{
    open: boolean;
    lotId: string;
    quantity: number;
  }>({
    open: false,
    lotId: '',
    quantity: 0,
  });

  const modelsQuery = trpc.iol.listModels.useQuery({
    includeInactive: showInactive,
    search: search.trim() || undefined,
  });
  const lotsQuery = trpc.iol.listLots.useQuery({ includeEmpty: true });

  const lotsByModel = useMemo(() => {
    const map = new Map<string, LotRow[]>();
    const all = (lotsQuery.data as LotRow[] | undefined) ?? [];
    for (const lot of all) {
      const arr = map.get(lot.modelId) ?? [];
      arr.push(lot);
      map.set(lot.modelId, arr);
    }
    return map;
  }, [lotsQuery.data]);

  const expiringSoon = useMemo(() => {
    const all = (lotsQuery.data as LotRow[] | undefined) ?? [];
    return all.filter((lot) => {
      const days = daysUntil(lot.expiresAt);
      return days >= 0 && days <= EXPIRY_WARNING_DAYS && lot.quantity > 0;
    });
  }, [lotsQuery.data]);

  const fmtDate = (d: string | Date) => {
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleDateString(dateLocale);
  };

  const models = (modelsQuery.data as ModelRow[] | undefined) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('iol:title')}
        description={t('iol:description')}
        actions={
          canManage ? (
            <Button onClick={() => setModelDialog({ open: true, existing: null })}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t('iol:newModel')}
            </Button>
          ) : null
        }
      />

      {expiringSoon.length > 0 && (
        <section
          role="status"
          className="rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning-foreground"
        >
          <p className="font-medium">
            {t('iol:warn.expiringTitle', { count: expiringSoon.length })}
          </p>
          <ul className="mt-1 text-xs">
            {expiringSoon.slice(0, 5).map((lot) => (
              <li key={lot.id}>
                {lot.model.brand} {lot.model.model} · lot {lot.lotNumber} ·{' '}
                {t('iol:warn.expiresIn', { days: daysUntil(lot.expiresAt) })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('iol:searchPlaceholder')}
          className="max-w-xs"
        />
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          {t('iol:showInactive')}
        </label>
      </section>

      <section className="rounded-lg border bg-background">
        {(modelsQuery.isError || lotsQuery.isError) && models.length === 0 ? (
          <div className="p-4">
            <DataErrorState
              onRetry={() => {
                void modelsQuery.refetch();
                void lotsQuery.refetch();
              }}
            />
          </div>
        ) : (
          <>
            {modelsQuery.isLoading && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t('common:actions.loading')}
              </p>
            )}
            {!modelsQuery.isLoading && models.length === 0 && <EmptyState title={t('iol:empty')} />}
            {models.map((m) => {
              const lots = lotsByModel.get(m.id) ?? [];
              const totalQty = lots.reduce((sum, l) => sum + l.quantity, 0);
              const isOpen = expanded[m.id] ?? false;
              return (
                <div key={m.id} className="border-b last:border-b-0">
                  <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/30">
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-2 text-left"
                      onClick={() => setExpanded((p) => ({ ...p, [m.id]: !p[m.id] }))}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-medium">
                        {m.brand} {m.model}
                      </span>
                      {!m.isActive && (
                        <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {t('iol:inactiveBadge')}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        · {t('iol:lotsCount', { count: lots.length })} ·{' '}
                        {t('iol:totalQty', { qty: totalQty })}
                      </span>
                    </button>
                    <div className="flex gap-2">
                      {canManage && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setLotDialog({ open: true, modelId: m.id, existing: null })
                            }
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            {t('iol:addLot')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setModelDialog({
                                open: true,
                                existing: {
                                  id: m.id,
                                  brand: m.brand,
                                  model: m.model,
                                  description: m.description,
                                  isActive: m.isActive,
                                  lensType: m.lensType,
                                  minQty: m.minQty,
                                },
                              })
                            }
                          >
                            {t('common:actions.edit')}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {isOpen && lots.length > 0 && (
                    <Table className="w-full text-sm">
                      <TableHeader className="bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <TableRow>
                          <TableHead className="px-4 py-2">{t('iol:cols.lotNumber')}</TableHead>
                          <TableHead className="px-4 py-2">{t('iol:cols.power')}</TableHead>
                          <TableHead className="px-4 py-2">
                            {t('iol:cols.available', { defaultValue: 'Müsait' })}
                          </TableHead>
                          <TableHead className="px-4 py-2">
                            {t('iol:cols.reserved', { defaultValue: 'Rezerve' })}
                          </TableHead>
                          <TableHead className="px-4 py-2">{t('iol:cols.expiresAt')}</TableHead>
                          <TableHead className="px-4 py-2">{t('iol:cols.supplier')}</TableHead>
                          <TableHead className="px-4 py-2"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lots.map((lot) => {
                          const eBadge = expiryBadge(lot.expiresAt);
                          // #401 — Müsait stok rozeti availableQty üzerinden (rezerve
                          // edilen lensler 'mevcut' sayılmaz).
                          const sBadge = stockBadge(lot.availableQty);
                          return (
                            <TableRow key={lot.id} className="border-t hover:bg-muted/10">
                              <TableCell className="px-4 py-2 font-mono text-xs">
                                {lot.lotNumber}
                              </TableCell>
                              <TableCell className="px-4 py-2 tabular-nums">
                                {Number(lot.power).toFixed(2)} D
                              </TableCell>
                              <TableCell className="px-4 py-2">
                                <Badge
                                  variant={
                                    sBadge === 'empty'
                                      ? 'critical'
                                      : sBadge === 'low'
                                        ? 'warning'
                                        : 'success'
                                  }
                                  className="tabular-nums"
                                >
                                  {lot.availableQty}
                                </Badge>
                              </TableCell>
                              <TableCell className="px-4 py-2 tabular-nums">
                                {lot.reservedQty > 0 ? (
                                  <Badge variant="info" className="tabular-nums">
                                    {lot.reservedQty}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">0</span>
                                )}
                              </TableCell>
                              <TableCell className="px-4 py-2">
                                <span
                                  className={`text-sm ${
                                    eBadge === 'expired'
                                      ? 'text-critical-foreground font-medium'
                                      : eBadge === 'warn'
                                        ? 'text-warning-foreground'
                                        : ''
                                  }`}
                                >
                                  {fmtDate(lot.expiresAt)}
                                </span>
                              </TableCell>
                              <TableCell className="px-4 py-2 text-xs text-muted-foreground">
                                {lot.supplier ?? '—'}
                              </TableCell>
                              <TableCell className="px-4 py-2 text-right">
                                <div className="flex justify-end gap-2">
                                  {canManage && (
                                    <>
                                      <Button
                                        size="icon-touch"
                                        variant="ghost"
                                        onClick={() =>
                                          setMovementDialog({
                                            open: true,
                                            lotId: lot.id,
                                            quantity: lot.quantity,
                                          })
                                        }
                                        aria-label={t('iol:movementForm.title')}
                                      >
                                        <ArrowRightLeft className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                          setLotDialog({
                                            open: true,
                                            modelId: m.id,
                                            existing: {
                                              id: lot.id,
                                              modelId: lot.modelId,
                                              lotNumber: lot.lotNumber,
                                              power: lot.power,
                                              expiresAt: lot.expiresAt,
                                              supplier: lot.supplier,
                                              notes: lot.notes,
                                            },
                                          })
                                        }
                                      >
                                        {t('common:actions.edit')}
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                  {isOpen && lots.length === 0 && <EmptyState title={t('iol:noLots')} />}
                </div>
              );
            })}
          </>
        )}
      </section>

      <IolModelForm
        open={modelDialog.open}
        onOpenChange={(o) => setModelDialog((p) => ({ ...p, open: o }))}
        existing={modelDialog.existing}
        onSaved={() => setModelDialog({ open: false, existing: null })}
      />
      <IolLotForm
        open={lotDialog.open}
        onOpenChange={(o) => setLotDialog((p) => ({ ...p, open: o }))}
        modelId={lotDialog.modelId}
        existing={lotDialog.existing}
        onSaved={() => setLotDialog({ open: false, modelId: '', existing: null })}
      />
      <IolMovementDialog
        open={movementDialog.open}
        onOpenChange={(o) => setMovementDialog((p) => ({ ...p, open: o }))}
        lotId={movementDialog.lotId}
        currentQuantity={movementDialog.quantity}
      />

      {/* S15-PR25 — Cerrahi kit uygunluk paneli */}
      <SurgicalKitsSection />
    </div>
  );
}
