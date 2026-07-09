import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
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
import { hasPermission } from '@airmed/contracts';
import { useAuth } from '../providers/AuthProvider';
import { SUPPLIER_CATEGORIES } from '../lib/pharmacy.constants';

// v0.4 #547 — Tedarikçiler ekranı. Backend (pharmacy.*Supplier tRPC) hazır;
// yalnız ekran. Yetki: page:suppliers (yönetici/asistan/stok&satınalma).

type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number];

interface SupplierRow {
  id: string;
  name: string;
  category: SupplierCategory;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
}

export function SuppliersPage() {
  const { t } = useTranslation(['pharmacy', 'common']);
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SupplierRow | null>(null);

  const canWrite = hasPermission(roles, 'action:supplier.create');
  const canDelete = hasPermission(roles, 'action:supplier.softDelete');

  const listQuery = trpc.pharmacy.listSuppliers.useQuery({ includeInactive: true });
  const rows = (listQuery.data ?? []) as unknown as SupplierRow[];

  const softDelete = trpc.pharmacy.softDeleteSupplier.useMutation({
    onSuccess: () => {
      toast.success(t('pharmacy:supplier.deleted', { defaultValue: 'Tedarikçi pasifleştirildi' }));
      void utils.pharmacy.listSuppliers.invalidate();
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('common:nav.suppliers', { defaultValue: 'Tedarikçiler' })}
        description={t('pharmacy:supplier.description', {
          defaultValue: 'Tedarikçi firmaları ekle, düzenle, pasifleştir.',
        })}
        actions={
          canWrite ? (
            <Button onClick={() => setCreating(true)} data-testid="supplier-new">
              <Plus className="mr-2 h-4 w-4" />
              {t('pharmacy:supplier.new', { defaultValue: 'Yeni tedarikçi' })}
            </Button>
          ) : undefined
        }
      />

      <section className="rounded-lg border bg-card">
        <header className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
          <Building2 className="h-4 w-4" />
          {t('pharmacy:supplier.listTitle', { defaultValue: 'Tedarikçiler' })}
        </header>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pharmacy:supplier.colName', { defaultValue: 'Ad' })}</TableHead>
              <TableHead>
                {t('pharmacy:supplier.colCategory', { defaultValue: 'Kategori' })}
              </TableHead>
              <TableHead>
                {t('pharmacy:supplier.colContact', { defaultValue: 'İletişim' })}
              </TableHead>
              <TableHead className="text-right">
                {t('pharmacy:supplier.colActions', { defaultValue: 'İşlem' })}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  {t('pharmacy:supplier.empty', { defaultValue: 'Henüz tedarikçi kaydı yok.' })}
                </TableCell>
              </TableRow>
            )}
            {rows.map((s) => (
              <TableRow key={s.id} className={s.isActive ? '' : 'opacity-50'}>
                <TableCell>
                  <div className="font-medium">{s.name}</div>
                  {s.address && <div className="text-xs text-muted-foreground">{s.address}</div>}
                </TableCell>
                <TableCell className="text-sm">
                  {t(`pharmacy:supplierCategory.${s.category}`, { defaultValue: s.category })}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {s.contactPhone && <div>{s.contactPhone}</div>}
                  {s.contactEmail && <div>{s.contactEmail}</div>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-1">
                    {canWrite && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title={t('common:actions.edit')}
                        onClick={() => setEditing(s)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && s.isActive && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title={t('common:actions.delete')}
                        onClick={() => setDeleteTarget(s)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {(creating || editing) && (
        <SupplierFormDialog
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            void utils.pharmacy.listSuppliers.invalidate();
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          title={t('pharmacy:supplier.deleteTitle', { defaultValue: 'Tedarikçiyi pasifleştir' })}
          description={t('pharmacy:supplier.deleteConfirm', {
            name: deleteTarget.name,
            defaultValue: `"${deleteTarget.name}" pasifleştirilsin mi?`,
          })}
          confirmLabel={t('common:actions.delete')}
          variant="destructive"
          onConfirm={() => softDelete.mutate({ id: deleteTarget.id })}
        />
      )}
    </div>
  );
}

function SupplierFormDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing: SupplierRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [name, setName] = useState(existing?.name ?? '');
  const [category, setCategory] = useState<SupplierCategory>(existing?.category ?? 'pharmacy');
  const [contactPhone, setContactPhone] = useState(existing?.contactPhone ?? '');
  const [contactEmail, setContactEmail] = useState(existing?.contactEmail ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const create = trpc.pharmacy.createSupplier.useMutation({
    onSuccess: () => {
      toast.success(t('pharmacy:supplier.created', { defaultValue: 'Tedarikçi eklendi' }));
      onSaved();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });
  const update = trpc.pharmacy.updateSupplier.useMutation({
    onSuccess: () => {
      toast.success(t('pharmacy:supplier.updated', { defaultValue: 'Tedarikçi güncellendi' }));
      onSaved();
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  const submit = () => {
    if (!name.trim()) return;
    const payload = {
      name: name.trim(),
      category,
      contactPhone: contactPhone.trim() || null,
      contactEmail: contactEmail.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
    };
    if (existing) {
      update.mutate({ id: existing.id, data: payload });
    } else {
      create.mutate(payload);
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>
          {existing
            ? t('pharmacy:supplier.editTitle', { defaultValue: 'Tedarikçi düzenle' })
            : t('pharmacy:supplier.new', { defaultValue: 'Yeni tedarikçi' })}
        </DialogTitle>
        <DialogDescription>
          {t('pharmacy:supplier.formHint', {
            defaultValue: 'Tedarikçi firma bilgileri (sipariş ve mal kabulde kullanılır).',
          })}
        </DialogDescription>
        <div className="mt-2 space-y-3">
          <div>
            <Label>{t('pharmacy:supplier.colName', { defaultValue: 'Ad' })}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <Label>{t('pharmacy:supplier.colCategory', { defaultValue: 'Kategori' })}</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value as SupplierCategory)}
            >
              {SUPPLIER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`pharmacy:supplierCategory.${c}`, { defaultValue: c })}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('pharmacy:supplier.colPhone', { defaultValue: 'Telefon' })}</Label>
              <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
            <div>
              <Label>{t('pharmacy:supplier.colEmail', { defaultValue: 'E-posta' })}</Label>
              <Input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>{t('pharmacy:supplier.colAddress', { defaultValue: 'Adres' })}</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div>
            <Label>{t('pharmacy:supplier.colNotes', { defaultValue: 'Not' })}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={submit} disabled={pending || !name.trim()}>
            {t('common:actions.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
