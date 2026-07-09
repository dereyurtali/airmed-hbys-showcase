import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

// Bölüm 24 — aranabilir tek-seçim. cmdk + Popover üstüne. Arama girişi h-8,
// boş durum "Sonuç yok" (ikon yok). Seçili item check = text-primary.
export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Seçin',
  searchPlaceholder = 'Ara…',
  emptyText = 'Sonuç yok',
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'focus-ring flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-field bg-background px-3 text-sm hover:border-field-hover',
            className,
          )}
        >
          <span className={cn('line-clamp-1 text-left', !selected && 'text-[color:var(--ph)]')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown size={16} strokeWidth={1.5} className="shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" align="start">
        <CommandPrimitive className="w-full">
          <div className="flex h-8 items-center gap-2 border-b px-2">
            <Search size={14} strokeWidth={1.5} className="shrink-0 opacity-50" aria-hidden />
            <CommandPrimitive.Input
              placeholder={searchPlaceholder}
              className="flex h-8 w-full bg-transparent text-[13px] outline-none placeholder:text-[color:var(--ph)]"
            />
          </div>
          <CommandPrimitive.List className="mt-1 max-h-60 overflow-y-auto">
            <CommandPrimitive.Empty className="py-4 text-center text-[12px] font-medium text-muted-foreground">
              {emptyText}
            </CommandPrimitive.Empty>
            {options.map((opt) => (
              <CommandPrimitive.Item
                key={opt.value}
                value={opt.label}
                onSelect={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className="relative flex h-9 cursor-default select-none items-center rounded-md pl-2 pr-8 text-[13px] font-medium outline-none aria-selected:bg-[color:var(--hover)]"
              >
                {opt.label}
                {opt.value === value && (
                  <Check
                    size={16}
                    strokeWidth={1.5}
                    className="absolute right-2 text-primary"
                    aria-hidden
                  />
                )}
              </CommandPrimitive.Item>
            ))}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}
