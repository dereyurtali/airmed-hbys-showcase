import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Boxes, Minus, Package, Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
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

// #372 — Sarf malzeme (Consumable) + Cerrahi Kit yönetimi (CRUD). Eskiden ikisi
// de seed-only / salt-okunurdu. Yönetici/asistan yetkisi.

interface ConsumableRow {
  id: string;
  name: string;
  code: string | null;
  category: string | null;
  unit: string | null;
  availableQty: number;
  reservedQty: number;
  minQty: number;
  isActive: boolean;
}

type CategoryKey = 'supply' | 'drug';

export function ConsumableManagePage() {
  const { t } = useTranslation(['iol', 'common']);
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<ConsumableRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<ConsumableRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConsumableRow | null>(null);

  const listQuery = trpc.consumable.list.useQuery({ includeInactive: true });
  const rows = (listQuery.data ?? []) as unknown as ConsumableRow[];

  const softDelete = trpc.consumable.softDelete.useMutation({
    onSuccess: () => {
      toast.success(t('iol:consumable.deleted', { defaultValue: 'Sarf malzeme silindi' }));
      void utils.consumable.list.invalidate();
      // #407 — admin kenar çubuğu/Genel Bakış kritik-stok rozeti anında tazelensin.
      void utils.dashboard.stockOverview.invalidate();
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('iol:consumable.title', { defaultValue: 'Sarf Malzeme & Kit Yönetimi' })}
        description={t('iol:consumable.description', {
          defaultValue: 'Genel sarf/ilaç stok kartları ve cerrahi kit reçeteleri.',
        })}
        actions={
          <Button onClick={() => setCreating(true)} data-testid="consumable-new">
            <Plus className="mr-2 h-4 w-4" />
            {t('iol:consumable.new', { defaultValue: 'Yeni sarf' })}
          </Button>
        }
      />

      <section className="rounded-lg border bg-card">
        <header className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
          <Package className="h-4 w-4" />
          {t('iol:consumable.listTitle', { defaultValue: 'Sarf Malzemeler' })}
        </header>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('iol:consumable.colName', { defaultValue: 'Ad' })}</TableHead>
              <TableHead>{t('iol:consumable.colCategory', { defaultValue: 'Grup' })}</TableHead>
              <TableHead className="text-right">
                {t('iol:cols.available', { defaultValue: 'Müsait' })}
              </TableHead>
              <TableHead className="text-right">
                {t('iol:consumable.colMin', { defaultValue: 'Min' })}
              </TableHead>
              <TableHead className="text-right">
                {t('iol:consumable.colActions', { defaultValue: 'İşlem' })}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {t('iol:consumable.empty', { defaultValue: 'Henüz sarf malzeme kaydı yok.' })}
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => {
              const low = c.availableQty <= c.minQty;
              return (
                <TableRow key={c.id} className={c.isActive ? '' : 'opacity-50'}>
                  <TableCell>
                    <div className="font-medium">{c.name}</div>
                    {c.code && <div className="text-xs text-muted-foreground">{c.code}</div>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {t(`iol:consumable.category.${c.category ?? 'supply'}`, {
                      defaultValue: c.category ?? 'supply',
                    })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {low ? (
                      <Badge variant="warning" className="tabular-nums">
                        {c.availableQty}
                        {c.unit ? ` ${c.unit}` : ''}
                      </Badge>
                    ) : (
                      <span>
                        {c.availableQty}
                        {c.unit ? ` ${c.unit}` : ''}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {c.minQty}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title={t('iol:consumable.adjust', { defaultValue: 'Stok düzelt' })}
                        onClick={() => setAdjustTarget(c)}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={t('common:actions.edit')}
                        onClick={() => setEditing(c)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={t('common:actions.delete')}
                        onClick={() => setDeleteTarget(c)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <SurgicalKitSection />

      {(creating || editing) && (
        <ConsumableFormDialog
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            void utils.consumable.list.invalidate();
            // #407 — stok kartı eklendi/güncellendi → Genel Bakış kritik-stok rozeti.
            void utils.dashboard.stockOverview.invalidate();
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {adjustTarget && (
        <AdjustDialog
          target={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onSaved={() => {
            void utils.consumable.list.invalidate();
            // #407 — stok düzeltildi → kritik-stok rozeti anında tazelensin.
            void utils.dashboard.stockOverview.invalidate();
            setAdjustTarget(null);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          title={t('iol:consumable.deleteTitle', { defaultValue: 'Sarf malzeme sil' })}
          description={t('iol:consumable.deleteConfirm', {
            name: deleteTarget.name,
            defaultValue: `"${deleteTarget.name}" silinsin mi?`,
          })}
          confirmLabel={t('common:actions.delete')}
          variant="destructive"
          onConfirm={() => softDelete.mutate({ id: deleteTarget.id })}
        />
      )}
    </div>
  );
}

function ConsumableFormDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing: ConsumableRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['iol', 'common']);
  const [name, setName] = useState(existing?.name ?? '');
  const [code, setCode] = useState(existing?.code ?? '');
  const [category, setCategory] = useState<CategoryKey>(
    (existing?.category as CategoryKey) ?? 'supply',
  );
  const [unit, setUnit] = useState(existing?.unit ?? '');
  const [availableQty, setAvailableQty] = useState(String(existing?.availableQty ?? 0));
  const [minQty, setMinQty] = useState(String(existing?.minQty ?? 0));

  const create = trpc.consumable.create.useMutation({
    onSuccess: () => {
      toast.success(t('iol:consumable.created', { defaultValue: 'Sarf malzeme eklendi' }));
      onSaved();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });
  const update = trpc.consumable.update.useMutation({
    onSuccess: () => {
      toast.success(t('iol:consumable.updated', { defaultValue: 'Sarf malzeme güncellendi' }));
      onSaved();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  const submit = () => {
    if (!name.trim()) return;
    if (existing) {
      update.mutate({
        id: existing.id,
        data: {
          name: name.trim(),
          code: code.trim() || null,
          category,
          unit: unit.trim() || null,
          minQty: parseInt(minQty, 10) || 0,
        },
      });
    } else {
      create.mutate({
        name: name.trim(),
        code: code.trim() || null,
        category,
        unit: unit.trim() || null,
        availableQty: parseInt(availableQty, 10) || 0,
        minQty: parseInt(minQty, 10) || 0,
      });
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>
          {existing
            ? t('iol:consumable.editTitle', { defaultValue: 'Sarf malzeme düzenle' })
            : t('iol:consumable.new', { defaultValue: 'Yeni sarf' })}
        </DialogTitle>
        <DialogDescription>
          {t('iol:consumable.formHint', {
            defaultValue: 'Genel sarf/ilaç stok kartı (lot/parti takibi yok).',
          })}
        </DialogDescription>
        <div className="mt-2 space-y-3">
          <div>
            <Label>{t('iol:consumable.colName', { defaultValue: 'Ad' })}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('iol:consumable.colCode', { defaultValue: 'Kod' })}</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="VSC" />
            </div>
            <div>
              <Label>{t('iol:consumable.colCategory', { defaultValue: 'Grup' })}</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value as CategoryKey)}
              >
                <option value="supply">
                  {t('iol:consumable.category.supply', { defaultValue: 'Sarf' })}
                </option>
                <option value="drug">
                  {t('iol:consumable.category.drug', { defaultValue: 'İlaç' })}
                </option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>{t('iol:consumable.colUnit', { defaultValue: 'Birim' })}</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="adet" />
            </div>
            {!existing && (
              <div>
                <Label>{t('iol:cols.available', { defaultValue: 'Müsait' })}</Label>
                <Input
                  type="number"
                  min={0}
                  value={availableQty}
                  onChange={(e) => setAvailableQty(e.target.value)}
                />
              </div>
            )}
            <div>
              <Label>{t('iol:consumable.colMin', { defaultValue: 'Min' })}</Label>
              <Input
                type="number"
                min={0}
                value={minQty}
                onChange={(e) => setMinQty(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={submit}
              disabled={pending || !name.trim()}
              data-testid="consumable-save"
            >
              {t('common:actions.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({
  target,
  onClose,
  onSaved,
}: {
  target: ConsumableRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['iol', 'common']);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const adjust = trpc.consumable.adjust.useMutation({
    onSuccess: () => {
      toast.success(t('iol:consumable.adjusted', { defaultValue: 'Stok güncellendi' }));
      onSaved();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });
  const n = parseInt(delta, 10);
  const valid = !Number.isNaN(n) && n !== 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>
          {t('iol:consumable.adjustTitle', { defaultValue: 'Stok düzelt' })}
        </DialogTitle>
        <DialogDescription>
          {target.name} — {t('iol:cols.available', { defaultValue: 'Müsait' })}:{' '}
          {target.availableQty}
        </DialogDescription>
        <div className="mt-2 space-y-3">
          <div>
            <Label>{t('iol:consumable.delta', { defaultValue: 'Değişim (+/-)' })}</Label>
            <Input
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="+10 / -3"
              autoFocus
            />
          </div>
          <div>
            <Label>{t('iol:consumable.reason', { defaultValue: 'Gerekçe (opsiyonel)' })}</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() =>
                adjust.mutate({ id: target.id, delta: n, reason: reason.trim() || null })
              }
              disabled={!valid || adjust.isPending}
            >
              {t('common:actions.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Cerrahi Kit yönetimi ----
interface KitComponent {
  iolModelId: string | null;
  componentName: string | null;
  quantity: number;
  isRequired: boolean;
}
interface KitRow {
  id: string;
  code: string;
  name: string;
  surgeryType: string;
  notes: string | null;
  components: KitComponent[];
}

function SurgicalKitSection() {
  const { t } = useTranslation(['iol', 'common']);
  const utils = trpc.useUtils();
  const kitsQuery = trpc.iol.kitList.useQuery();
  const kits = (kitsQuery.data ?? []) as unknown as KitRow[];
  const [editing, setEditing] = useState<KitRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KitRow | null>(null);

  const softDelete = trpc.iol.kitSoftDelete.useMutation({
    onSuccess: () => {
      toast.success(t('iol:kit.deleted', { defaultValue: 'Kit silindi' }));
      void utils.iol.kitList.invalidate();
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <Wrench className="h-4 w-4" />
          {t('iol:kit.title', { defaultValue: 'Cerrahi Kitler' })}
        </span>
        <Button size="sm" variant="outline" onClick={() => setCreating(true)} data-testid="kit-new">
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('iol:kit.new', { defaultValue: 'Yeni kit' })}
        </Button>
      </header>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('iol:kit.colCode', { defaultValue: 'Kod' })}</TableHead>
            <TableHead>{t('iol:kit.colName', { defaultValue: 'Ad' })}</TableHead>
            <TableHead>{t('iol:kit.colType', { defaultValue: 'Cerrahi tip' })}</TableHead>
            <TableHead className="text-right">
              {t('iol:kit.colComponents', { defaultValue: 'Komponent' })}
            </TableHead>
            <TableHead className="text-right">
              {t('iol:consumable.colActions', { defaultValue: 'İşlem' })}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {kits.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                {t('iol:kit.empty', { defaultValue: 'Henüz kit tanımlı değil.' })}
              </TableCell>
            </TableRow>
          )}
          {kits.map((k) => (
            <TableRow key={k.id}>
              <TableCell className="font-mono text-xs">{k.code}</TableCell>
              <TableCell className="font-medium">{k.name}</TableCell>
              <TableCell className="text-sm">{k.surgeryType}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {k.components.length}
              </TableCell>
              <TableCell className="text-right">
                <div className="inline-flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setEditing(k)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(k)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {(creating || editing) && (
        <KitFormDialog
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            void utils.iol.kitList.invalidate();
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          title={t('iol:kit.deleteTitle', { defaultValue: 'Kit sil' })}
          description={t('iol:kit.deleteConfirm', {
            name: deleteTarget.name,
            defaultValue: `"${deleteTarget.name}" kiti silinsin mi?`,
          })}
          confirmLabel={t('common:actions.delete')}
          variant="destructive"
          onConfirm={() => softDelete.mutate({ id: deleteTarget.id })}
        />
      )}
    </section>
  );
}

function KitFormDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing: KitRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['iol', 'common']);
  const [code, setCode] = useState(existing?.code ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [surgeryType, setSurgeryType] = useState(existing?.surgeryType ?? '');
  const [components, setComponents] = useState<{ componentName: string; quantity: number }[]>(
    existing?.components.map((c) => ({
      componentName: c.componentName ?? '',
      quantity: c.quantity,
    })) ?? [],
  );

  const create = trpc.iol.kitCreate.useMutation({
    onSuccess: () => {
      toast.success(t('iol:kit.created', { defaultValue: 'Kit eklendi' }));
      onSaved();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });
  const update = trpc.iol.kitUpdate.useMutation({
    onSuccess: () => {
      toast.success(t('iol:kit.updated', { defaultValue: 'Kit güncellendi' }));
      onSaved();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  const submit = () => {
    const comps = components
      .filter((c) => c.componentName.trim())
      .map((c) => ({
        componentName: c.componentName.trim(),
        quantity: c.quantity,
        isRequired: true,
      }));
    if (existing) {
      update.mutate({
        id: existing.id,
        name: name.trim(),
        surgeryType: surgeryType.trim(),
        components: comps,
      });
    } else {
      create.mutate({
        code: code.trim(),
        name: name.trim(),
        surgeryType: surgeryType.trim(),
        components: comps,
      });
    }
  };

  const canSubmit = name.trim() && surgeryType.trim() && (existing || code.trim());
  const pending = create.isPending || update.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>
          {existing
            ? t('iol:kit.editTitle', { defaultValue: 'Kit düzenle' })
            : t('iol:kit.new', { defaultValue: 'Yeni kit' })}
        </DialogTitle>
        <DialogDescription>
          {t('iol:kit.formHint', {
            defaultValue: 'Bir cerrahi tip için gerekli sarf/komponent reçetesi.',
          })}
        </DialogDescription>
        <div className="mt-2 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('iol:kit.colCode', { defaultValue: 'Kod' })}</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={!!existing}
                placeholder="KIT-PHACO"
              />
            </div>
            <div>
              <Label>{t('iol:kit.colType', { defaultValue: 'Cerrahi tip' })}</Label>
              <Input
                value={surgeryType}
                onChange={(e) => setSurgeryType(e.target.value)}
                placeholder="cataract"
              />
            </div>
          </div>
          <div>
            <Label>{t('iol:kit.colName', { defaultValue: 'Ad' })}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>{t('iol:kit.components', { defaultValue: 'Komponentler' })}</Label>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setComponents((p) => [...p, { componentName: '', quantity: 1 }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('iol:kit.addComponent', { defaultValue: 'Ekle' })}
              </Button>
            </div>
            <div className="space-y-2">
              {components.length === 0 && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Boxes className="h-3.5 w-3.5" />
                  {t('iol:kit.noComponents', { defaultValue: 'Komponent eklenmedi.' })}
                </p>
              )}
              {components.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={c.componentName}
                    onChange={(e) =>
                      setComponents((p) =>
                        p.map((x, j) => (j === i ? { ...x, componentName: e.target.value } : x)),
                      )
                    }
                    placeholder={t('iol:kit.componentName', { defaultValue: 'Malzeme adı' })}
                  />
                  <Input
                    type="number"
                    min={1}
                    className="w-20"
                    value={c.quantity}
                    onChange={(e) =>
                      setComponents((p) =>
                        p.map((x, j) =>
                          j === i ? { ...x, quantity: parseInt(e.target.value, 10) || 1 } : x,
                        ),
                      )
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setComponents((p) => p.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={submit} disabled={!canSubmit || pending} data-testid="kit-save">
              {t('common:actions.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
