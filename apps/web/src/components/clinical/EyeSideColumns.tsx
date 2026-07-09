import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

/**
 * OD/OS iki-kolon yerleşimi — Karar 1 (v0.4.2). Göz hekimi iki gözü sürekli kıyaslar;
 * yan yana OD (sol kolon) | OS (sağ kolon) + "OU (her iki göz aynı)" kısayolu.
 * `linked=true` iken tek kolon (OU) gösterilir — her iki göze aynı değer.
 * Per-eye alanları `renderEye` ile çizilir (ölçüm/muayene formları extend eder).
 */

interface EyeSideColumnsProps {
  renderEye: (eye: 'od' | 'os') => ReactNode;
  /** OU modu — her iki göz aynı. Verilirse başlıkta kısayol checkbox'ı çıkar. */
  linked?: boolean;
  onLinkedChange?: (linked: boolean) => void;
  odLabel?: string;
  osLabel?: string;
  linkLabel?: string;
  className?: string;
}

export function EyeSideColumns({
  renderEye,
  linked = false,
  onLinkedChange,
  odLabel,
  osLabel,
  linkLabel,
  className,
}: EyeSideColumnsProps) {
  const { t } = useTranslation(['clinical']);
  const od = odLabel ?? t('clinical:eyeSide.odColumn');
  const os = osLabel ?? t('clinical:eyeSide.osColumn');
  const link = linkLabel ?? t('clinical:eyeSide.linkBoth');

  return (
    <div className={cn('space-y-3', className)}>
      {onLinkedChange && (
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={linked}
            onChange={(e) => onLinkedChange(e.target.checked)}
            className="h-4 w-4 rounded border-field"
            data-testid="eye-columns-link"
          />
          {link}
        </label>
      )}

      {linked ? (
        <section
          className="rounded-lg border bg-muted/30 p-3"
          aria-label={t('clinical:eyeSide.ou')}
          data-testid="eye-columns-ou"
        >
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">
            {t('clinical:eyeSide.ou')}
          </h4>
          {renderEye('od')}
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <section
            className="rounded-lg border bg-muted/30 p-3"
            aria-label={od}
            data-testid="eye-columns-od"
          >
            <h4 className="mb-2 text-sm font-medium text-muted-foreground">{od}</h4>
            {renderEye('od')}
          </section>
          <section
            className="rounded-lg border bg-muted/30 p-3"
            aria-label={os}
            data-testid="eye-columns-os"
          >
            <h4 className="mb-2 text-sm font-medium text-muted-foreground">{os}</h4>
            {renderEye('os')}
          </section>
        </div>
      )}
    </div>
  );
}
