import { localeToIntl } from '../lib/i18n-format';
import { useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { EmptyState } from '../components/ui/empty-state';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { confirmIfDirty } from '../hooks/useUnsavedWarning';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { CURRENCIES, SERVICE_CATEGORIES, formatMoney } from '../lib/billing.constants';
import type { Currency, ServiceCategory } from '../lib/billing.constants';
import { billingApi, type ServiceItemRow } from '../lib/billing.trpc';
import { useLocale } from '../providers/LocaleProvider';

const looseCreate = billingApi.createServiceItem as unknown as {
  useMutation: (opts?: {
    onSuccess?: (data: ServiceItemRow) => void;
    onError?: (err: { message: string }) => void;
  }) => { mutate: (input: unknown) => void; isPending: boolean };
};
const looseUpdate = billingApi.updateServiceItem as unknown as {
  useMutation: (opts?: {
    onSuccess?: (data: ServiceItemRow) => void;
    onError?: (err: { message: string }) => void;
  }) => { mutate: (input: unknown) => void; isPending: boolean };
};
const looseDelete = billingApi.softDeleteServiceItem as unknown as {
  useMutation: (opts?: {
    onSuccess?: (data: { ok: true }) => void;
    onError?: (err: { message: string }) => void;
  }) => { mutate: (input: { id: string }) => void; isPending: boolean };
};

interface Draft {
  id?: string;
  code: string;
  name: string;
  nameRu: string;
  nameTg: string;
  category: ServiceCategory;
  defaultPrice: string;
  defaultCurrency: Currency;
  sortOrder: number;
  isActive: boolean;
  // Madde 5 — ön şartlar form'da string olarak tutulur, kaydederken Number'a çevrilir.
  preconditionMinAge: string;
  preconditionMaxAge: string;
  preconditionRequiredCodes: string; // virgülle ayrılmış kodlar
  ageDiscountMinAge: string;
  ageDiscountPercent: string;
}

const EMPTY_DRAFT: Draft = {
  code: '',
  name: '',
  nameRu: '',
  nameTg: '',
  category: 'examination',
  defaultPrice: '0',
  defaultCurrency: 'TJS',
  sortOrder: 0,
  isActive: true,
  preconditionMinAge: '',
  preconditionMaxAge: '',
  preconditionRequiredCodes: '',
  ageDiscountMinAge: '',
  ageDiscountPercent: '',
};

export function ServiceCatalogPage() {
  const { t } = useTranslation(['billing', 'common']);
  // #406 — hizmet silme geri-alınamaz; native confirm yerine ConfirmDialog.
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { locale } = useLocale();

  const [editor, setEditor] = useState<Draft | null>(null);
  // Açılış anındaki taslak — dirty tespiti için (editor wholesale değişir).
  const editorInitial = useRef<Draft | null>(null);
  const openEditor = (draft: Draft) => {
    editorInitial.current = draft;
    setEditor(draft);
  };
  const editorDirty =
    editor !== null &&
    editorInitial.current !== null &&
    JSON.stringify(editor) !== JSON.stringify(editorInitial.current);
  const handleEditorOpenChange = (next: boolean) => {
    if (next) return;
    if (!confirmIfDirty(editorDirty, t('common:forms.unsavedConfirm'))) return;
    setEditor(null);
  };

  const listQuery = billingApi.listServiceItems.useQuery({ includeInactive: true });

  const createMut = looseCreate.useMutation({
    onSuccess: () => {
      toast.success(t('billing:serviceCatalog.createdToast'));
      void listQuery.refetch();
      setEditor(null);
    },
    onError: (err) => toast.error(err.message ?? 'Hata'),
  });
  const updateMut = looseUpdate.useMutation({
    onSuccess: () => {
      toast.success(t('billing:serviceCatalog.updatedToast'));
      void listQuery.refetch();
      setEditor(null);
    },
    onError: (err) => toast.error(err.message ?? 'Hata'),
  });
  const deleteMut = looseDelete.useMutation({
    onSuccess: () => {
      toast.success(t('billing:serviceCatalog.deletedToast'));
      void listQuery.refetch();
    },
    onError: (err) => toast.error(err.message ?? 'Hata'),
  });

  const onSave = () => {
    if (!editor) return;
    // Madde 5 — preconditions normalize. Boş string'ler atılır; en az bir
    // anlamlı alan varsa preconditions gönderilir, hepsi boşsa undefined.
    const preconditions: Record<string, unknown> = {};
    if (editor.preconditionMinAge !== '') {
      preconditions.minAge = Number(editor.preconditionMinAge);
    }
    if (editor.preconditionMaxAge !== '') {
      preconditions.maxAge = Number(editor.preconditionMaxAge);
    }
    const codes = editor.preconditionRequiredCodes
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
    if (codes.length > 0) preconditions.requiredServiceCodes = codes;
    if (editor.ageDiscountMinAge !== '' && editor.ageDiscountPercent !== '') {
      preconditions.ageDiscount = {
        minAge: Number(editor.ageDiscountMinAge),
        percent: Number(editor.ageDiscountPercent),
      };
    }
    const payload = {
      code: editor.code.trim().toUpperCase(),
      name: editor.name.trim(),
      nameRu: editor.nameRu.trim() || null,
      nameTg: editor.nameTg.trim() || null,
      category: editor.category,
      defaultPrice: editor.defaultPrice,
      defaultCurrency: editor.defaultCurrency,
      sortOrder: editor.sortOrder,
      preconditions: Object.keys(preconditions).length > 0 ? preconditions : undefined,
    };
    if (editor.id) {
      updateMut.mutate({ id: editor.id, data: { ...payload, isActive: editor.isActive } });
    } else {
      createMut.mutate(payload);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('billing:serviceCatalog.title')}
        description={t('billing:serviceCatalog.subtitle')}
        actions={
          <Button onClick={() => openEditor({ ...EMPTY_DRAFT })}>
            <Plus className="mr-2 h-4 w-4" />
            {t('billing:serviceCatalog.new')}
          </Button>
        }
      />

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('billing:serviceCatalog.code')}</TableHead>
              <TableHead>{t('billing:serviceCatalog.name')}</TableHead>
              <TableHead>{t('billing:serviceCatalog.category')}</TableHead>
              <TableHead className="text-right">
                {t('billing:serviceCatalog.defaultPrice')}
              </TableHead>
              <TableHead>{t('billing:serviceCatalog.active')}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.data && listQuery.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState title={t('billing:serviceCatalog.noItems')} />
                </TableCell>
              </TableRow>
            )}
            {(listQuery.data ?? []).map((item: ServiceItemRow) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-xs">{item.code}</TableCell>
                <TableCell>{item.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {t(`billing:serviceCatalog.categoryLabel.${item.category}`)}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatMoney(item.defaultPrice, item.defaultCurrency, localeToIntl(locale))}
                </TableCell>
                <TableCell>
                  {item.isActive ? (
                    <Badge variant="success">✓</Badge>
                  ) : (
                    <Badge variant="neutral">—</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const pre =
                        (item as { preconditions?: Record<string, unknown> | null })
                          .preconditions ?? {};
                      const ad = (pre as { ageDiscount?: { minAge?: number; percent?: number } })
                        .ageDiscount;
                      openEditor({
                        id: item.id,
                        code: item.code,
                        name: item.name,
                        nameRu: item.nameRu ?? '',
                        nameTg: item.nameTg ?? '',
                        category: item.category,
                        defaultPrice: item.defaultPrice,
                        defaultCurrency: item.defaultCurrency,
                        sortOrder: item.sortOrder,
                        isActive: item.isActive,
                        preconditionMinAge:
                          typeof (pre as { minAge?: number }).minAge === 'number'
                            ? String((pre as { minAge: number }).minAge)
                            : '',
                        preconditionMaxAge:
                          typeof (pre as { maxAge?: number }).maxAge === 'number'
                            ? String((pre as { maxAge: number }).maxAge)
                            : '',
                        preconditionRequiredCodes: Array.isArray(
                          (pre as { requiredServiceCodes?: string[] }).requiredServiceCodes,
                        )
                          ? (pre as { requiredServiceCodes: string[] }).requiredServiceCodes.join(
                              ', ',
                            )
                          : '',
                        ageDiscountMinAge:
                          ad && typeof ad.minAge === 'number' ? String(ad.minAge) : '',
                        ageDiscountPercent:
                          ad && typeof ad.percent === 'number' ? String(ad.percent) : '',
                      });
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleteId(item.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editor !== null} onOpenChange={handleEditorOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-auto">
          {editor && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSave();
              }}
            >
              <DialogTitle className="mb-4">
                {editor.id ? t('billing:serviceCatalog.edit') : t('billing:serviceCatalog.new')}
              </DialogTitle>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t('billing:serviceCatalog.code')}</Label>
                    <Input
                      value={editor.code}
                      onChange={(e) => setEditor({ ...editor, code: e.target.value.toUpperCase() })}
                      placeholder="EXAM_BASIC"
                    />
                  </div>
                  <div>
                    <Label>{t('billing:serviceCatalog.category')}</Label>
                    <select
                      value={editor.category}
                      onChange={(e) =>
                        setEditor({ ...editor, category: e.target.value as ServiceCategory })
                      }
                      className="focus-ring h-10 w-full rounded-lg border border-field bg-background px-3 text-sm hover:border-field-hover"
                    >
                      {SERVICE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {t(`billing:serviceCatalog.categoryLabel.${c}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <Label>{t('billing:serviceCatalog.name')}</Label>
                  <Input
                    value={editor.name}
                    onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t('billing:serviceCatalog.nameRu')}</Label>
                    <Input
                      value={editor.nameRu}
                      onChange={(e) => setEditor({ ...editor, nameRu: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>{t('billing:serviceCatalog.nameTg')}</Label>
                    <Input
                      value={editor.nameTg}
                      onChange={(e) => setEditor({ ...editor, nameTg: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>{t('billing:serviceCatalog.defaultPrice')}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editor.defaultPrice}
                      onChange={(e) => setEditor({ ...editor, defaultPrice: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>{t('billing:serviceCatalog.defaultCurrency')}</Label>
                    <select
                      value={editor.defaultCurrency}
                      onChange={(e) =>
                        setEditor({ ...editor, defaultCurrency: e.target.value as Currency })
                      }
                      className="focus-ring h-10 w-full rounded-lg border border-field bg-background px-3 text-sm hover:border-field-hover"
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>{t('billing:serviceCatalog.sortOrder')}</Label>
                    <Input
                      type="number"
                      value={editor.sortOrder}
                      onChange={(e) =>
                        setEditor({ ...editor, sortOrder: parseInt(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>

                {editor.id && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editor.isActive}
                      onChange={(e) => setEditor({ ...editor, isActive: e.target.checked })}
                    />
                    {t('billing:serviceCatalog.active')}
                  </label>
                )}

                {/* Madde 5 — Ön Şartlar */}
                <div className="space-y-3 rounded-xl border bg-background p-4">
                  <div className="text-sm font-semibold">
                    {t('billing:serviceCatalog.preconditions.title')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('billing:serviceCatalog.preconditions.hint')}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t('billing:serviceCatalog.preconditions.minAge')}</Label>
                      <Input
                        type="number"
                        min="0"
                        max="150"
                        placeholder="—"
                        value={editor.preconditionMinAge}
                        onChange={(e) =>
                          setEditor({ ...editor, preconditionMinAge: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label>{t('billing:serviceCatalog.preconditions.maxAge')}</Label>
                      <Input
                        type="number"
                        min="0"
                        max="150"
                        placeholder="—"
                        value={editor.preconditionMaxAge}
                        onChange={(e) =>
                          setEditor({ ...editor, preconditionMaxAge: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <Label>{t('billing:serviceCatalog.preconditions.requiredCodes')}</Label>
                    <Input
                      placeholder="MEAS_BIO, MEAS_TOPO"
                      value={editor.preconditionRequiredCodes}
                      onChange={(e) =>
                        setEditor({ ...editor, preconditionRequiredCodes: e.target.value })
                      }
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('billing:serviceCatalog.preconditions.requiredCodesHint')}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t('billing:serviceCatalog.preconditions.ageDiscountMinAge')}</Label>
                      <Input
                        type="number"
                        min="0"
                        max="150"
                        placeholder="65"
                        value={editor.ageDiscountMinAge}
                        onChange={(e) =>
                          setEditor({ ...editor, ageDiscountMinAge: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label>{t('billing:serviceCatalog.preconditions.ageDiscountPercent')}</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        placeholder="50"
                        value={editor.ageDiscountPercent}
                        onChange={(e) =>
                          setEditor({ ...editor, ageDiscountPercent: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('billing:serviceCatalog.preconditions.ageDiscountHint')}
                  </p>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleEditorOpenChange(false)}
                >
                  {t('common:actions.cancel')}
                </Button>
                <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>
                  {t('common:actions.save')}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title={t('common:actions.delete')}
        description={t('billing:serviceCatalog.deleteConfirm')}
        pending={deleteMut.isPending}
        onConfirm={() => {
          if (deleteId) deleteMut.mutate({ id: deleteId });
          setDeleteId(null);
        }}
      />
    </div>
  );
}
