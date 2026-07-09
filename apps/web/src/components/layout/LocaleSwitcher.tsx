import { Languages, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { type SupportedLocale } from '../../i18n';
import { useLocale } from '../../providers/LocaleProvider';

export function LocaleSwitcher() {
  const { t } = useTranslation('common');
  const { locale, supported, setLocale } = useLocale();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          aria-label={t('locale.switcherAria')}
          data-testid="locale-switcher"
        >
          <Languages className="h-4 w-4" />
          <span className="text-xs font-medium uppercase">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {supported.map((code) => (
          <DropdownMenuItem
            key={code}
            data-testid={`locale-option-${code}`}
            onSelect={() => {
              if (code !== locale) void setLocale(code as SupportedLocale);
            }}
          >
            <span className="flex w-full items-center justify-between gap-3">
              <span>{t(`locale.${code}`)}</span>
              {code === locale && <Check className="h-3.5 w-3.5 text-primary" />}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
