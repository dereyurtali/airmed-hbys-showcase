import { forwardRef, useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '../ui/input';

// Tahmin edilebilir ülke kodları — DemoEye + Tacikistan bölgesi
// Eklemek isterseniz sıralı tutmak için: name TR alfabetik.
export const COUNTRY_CODES = [
  { code: '+992', flag: '🇹🇯', name: 'Tacikistan' },
  { code: '+90', flag: '🇹🇷', name: 'Türkiye' },
  { code: '+7', flag: '🇷🇺', name: 'Rusya / Kazakistan' },
  { code: '+996', flag: '🇰🇬', name: 'Kırgızistan' },
  { code: '+998', flag: '🇺🇿', name: 'Özbekistan' },
  { code: '+93', flag: '🇦🇫', name: 'Afganistan' },
  { code: '+86', flag: '🇨🇳', name: 'Çin' },
  { code: '+1', flag: '🇺🇸', name: 'ABD / Kanada' },
  { code: '+44', flag: '🇬🇧', name: 'Birleşik Krallık' },
  { code: '+49', flag: '🇩🇪', name: 'Almanya' },
] as const;

const DEFAULT_CODE = '+992';

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  ariaInvalid?: boolean;
}

/**
 * Telefon girişi: ülke kodu dropdown + ulusal numara input.
 * - value tek bir string ("+992 901234567") olarak parent'a verilir
 * - parent boş string verirse default +992 set edilir (yeni hasta için)
 * - mevcut +992 / +90 / vb. prefix'li değer otomatik ayrıştırılır
 */
export const PhoneInput = forwardRef<HTMLInputElement, Props>(function PhoneInput(
  { value, onChange, placeholder, autoComplete, disabled, ariaInvalid },
  ref,
) {
  // Mevcut value'dan ülke kodu + ulusal kısmı çıkar
  const { initialCode, initialRest } = useMemo(() => parsePhone(value), [value]);

  const [code, setCode] = useState<string>(initialCode);
  const [rest, setRest] = useState<string>(initialRest);

  // Parent value değiştiğinde (örn. edit mode'da detail load) sync
  useEffect(() => {
    const { initialCode: c, initialRest: r } = parsePhone(value);
    setCode(c);
    setRest(r);
  }, [value]);

  const emit = (nextCode: string, nextRest: string) => {
    const cleaned = nextRest.replace(/[^0-9]/g, '');
    // Boşsa string'i tamamen boş ver (optional alan için)
    if (!cleaned) {
      onChange('');
    } else {
      onChange(`${nextCode}${cleaned}`);
    }
  };

  return (
    <div className="flex gap-2">
      <div className="relative">
        <select
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            emit(e.target.value, rest);
          }}
          disabled={disabled}
          aria-label="Ülke kodu"
          className="h-10 appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.code}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      <Input
        ref={ref}
        type="tel"
        inputMode="tel"
        value={rest}
        onChange={(e) => {
          // Sadece rakam kabul et (+, boşluk, tire input gelirse temizle)
          const cleaned = e.target.value.replace(/[^0-9]/g, '');
          setRest(cleaned);
          emit(code, cleaned);
        }}
        placeholder={placeholder ?? '901234567'}
        autoComplete={autoComplete ?? 'tel'}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        className="flex-1"
      />
    </div>
  );
});

function parsePhone(value: string): { initialCode: string; initialRest: string } {
  if (!value) return { initialCode: DEFAULT_CODE, initialRest: '' };
  // En uzun eşleşen ülke kodunu bul (örn. +998'i +9'dan önce dene)
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) {
    if (value.startsWith(c.code)) {
      return {
        initialCode: c.code,
        initialRest: value.slice(c.code.length).replace(/[^0-9]/g, ''),
      };
    }
  }
  // Tanınmıyorsa: + ile başlıyor ama listede yok → tamamı rest, default code
  if (value.startsWith('+')) {
    return { initialCode: DEFAULT_CODE, initialRest: value.replace(/[^0-9]/g, '') };
  }
  // Kod yok, sadece rakam → default
  return { initialCode: DEFAULT_CODE, initialRest: value.replace(/[^0-9]/g, '') };
}
