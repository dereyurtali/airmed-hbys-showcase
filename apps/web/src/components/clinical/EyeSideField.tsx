import { useTranslation } from 'react-i18next';
import { Label } from '../ui/label';
import { cn } from '../../lib/utils';

/**
 * Göz tarafı (OD/OS/OU) zorunlu seçici — airmed-design Ray 4 (yanlış-değer fiziksel engel).
 * Erişilebilir radyo-grubu; default seçim YOK (value=null), her kayıtta explicit seçim.
 * shadcn `<Select>` primitive'i projede yok; klinik idiom = ≥44px radyo-grup.
 */

export type EyeSide = 'od' | 'os' | 'ou';
export const EYE_SIDES: readonly EyeSide[] = ['od', 'os', 'ou'] as const;
export const EYE_SIDES_BILATERAL: readonly EyeSide[] = ['od', 'os'] as const;

interface EyeSideFieldProps {
  value: EyeSide | null;
  onChange: (value: EyeSide) => void;
  /** Sunulacak seçenekler. Default OD/OS/OU; cerrahi gibi tek-göz akışlarda OD/OS verilebilir. */
  options?: readonly EyeSide[];
  required?: boolean;
  disabled?: boolean;
  label?: string;
  /** Radyo input `name` (aynı sayfada birden çok grup ayrımı için). */
  name?: string;
  /** `data-testid` öneki — `${testIdPrefix}-${side}`. */
  testIdPrefix?: string;
  /** Seçenek etiketini özelleştir (mevcut ekranların i18n key'ini korumak için). */
  optionLabel?: (side: EyeSide) => string;
}

export function EyeSideField({
  value,
  onChange,
  options = EYE_SIDES,
  required = true,
  disabled = false,
  label,
  name = 'eye-side',
  testIdPrefix = 'eye',
  optionLabel,
}: EyeSideFieldProps) {
  const { t } = useTranslation(['clinical']);
  const labelText = label ?? t('clinical:eyeSide.label');
  const getLabel = optionLabel ?? ((side: EyeSide) => t(`clinical:eyeSide.${side}`));

  return (
    <div className="space-y-1.5">
      <Label>
        {labelText}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <div className="flex gap-3" role="radiogroup" aria-label={labelText} aria-required={required}>
        {options.map((side) => {
          const selected = value === side;
          return (
            <label
              key={side}
              className={cn(
                'flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm',
                selected
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-field bg-background',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <input
                type="radio"
                name={name}
                value={side}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(side)}
                className="sr-only"
                data-testid={`${testIdPrefix}-${side}`}
              />
              {getLabel(side)}
            </label>
          );
        })}
      </div>
    </div>
  );
}
