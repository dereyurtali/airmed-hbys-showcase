import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';
import { QuickAddPatientForm } from '../patient/QuickAddPatientForm';
import { usePermission } from '../../hooks/usePermission';
import { trpc } from '../../lib/trpc';

export interface SelectedPatient {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string;
}

interface Props {
  selected: SelectedPatient | null;
  onSelect: (patient: SelectedPatient | null) => void;
}

/**
 * Hasta seçici (cmdk typeahead). Üç durum: seçili çip · arama listesi · inline
 * hızlı kayıt. Hasta bulunamayınca (yetki varsa) "Yeni hasta ekle" ile ayrı
 * ekrana gitmeden kayıt oluşturup otomatik seçer. AppointmentDialog + fatura
 * akışı ortak kullanır.
 */
export function PatientCommandPicker({ selected, onSelect }: Props) {
  const { t } = useTranslation('appointment');
  const canCreate = usePermission('action:patient.create');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [mode, setMode] = useState<'search' | 'create'>('search');

  useEffect(() => {
    const tt = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(tt);
  }, [searchInput]);

  // Hasta seçilince inline kayıt modundan her zaman çık (prefill ile gelen
  // seçim sonrası "Değiştir"de eski create modu sızmasın).
  useEffect(() => {
    if (selected) setMode('search');
  }, [selected]);

  const list = trpc.patient.list.useQuery(
    { search: debouncedSearch || undefined, page: 1, pageSize: 10 },
    { enabled: debouncedSearch.length >= 2 || !selected },
  );

  return (
    <div className="space-y-2">
      {selected && (
        <div className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2 text-sm">
          <span>
            <span className="font-medium">
              {selected.firstName} {selected.lastName}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">{selected.mrn}</span>
          </span>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-xs text-primary hover:underline"
          >
            {t('commandPicker.change')}
          </button>
        </div>
      )}

      {!selected && mode === 'search' && (
        <>
          <Command>
            <CommandInput
              placeholder={t('commandPicker.searchPlaceholder')}
              value={searchInput}
              onValueChange={setSearchInput}
            />
            <CommandList>
              {list.isLoading && debouncedSearch.length >= 2 && (
                <div className="py-3 text-center text-xs text-muted-foreground">
                  {t('commandPicker.loading')}
                </div>
              )}
              {!list.isLoading && (
                <CommandEmpty>
                  {debouncedSearch.length < 2
                    ? t('commandPicker.minChars')
                    : t('commandPicker.noResults')}
                </CommandEmpty>
              )}
              {list.data && list.data.items.length > 0 && (
                <CommandGroup>
                  {list.data.items.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={p.id}
                      onSelect={() =>
                        onSelect({
                          id: p.id,
                          firstName: p.firstName,
                          lastName: p.lastName,
                          mrn: p.mrn,
                        })
                      }
                    >
                      <span className="font-medium">
                        {p.firstName} {p.lastName}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">{p.mrn}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>

          {canCreate && (
            <button
              type="button"
              data-testid="patient-picker-quick-add"
              onClick={() => setMode('create')}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-input px-3 py-2 text-sm text-primary transition-colors hover:bg-primary/5"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {debouncedSearch
                ? t('quickAdd.ctaNamed', { name: debouncedSearch })
                : t('quickAdd.cta')}
            </button>
          )}
        </>
      )}

      {!selected && mode === 'create' && (
        <QuickAddPatientForm
          initialName={searchInput}
          onCreated={(p) => {
            onSelect(p);
            setMode('search');
          }}
          onCancel={() => setMode('search')}
        />
      )}
    </div>
  );
}
