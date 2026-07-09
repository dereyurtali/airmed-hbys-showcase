import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import {
  getReceiptAutoprintMode,
  setReceiptAutoprintMode,
  type ReceiptAutoprintMode,
} from '../lib/receipt-prefs';

// Karşılama tercih ekranı (cihaz-bazlı).
// localStorage'da saklanır — backend tarafına taşımak gerekirse
// Tenant.receiptAutoprint kolonuna migrate edilir.

export function ReceptionPreferencesPage() {
  const { t } = useTranslation(['receptionQueue', 'common']);
  const [mode, setMode] = useState<ReceiptAutoprintMode>(() => getReceiptAutoprintMode());

  const toggle = (next: ReceiptAutoprintMode) => {
    setReceiptAutoprintMode(next);
    setMode(next);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title={t('receptionQueue:prefs.title')}
        description={t('receptionQueue:prefs.description')}
      />

      <section className="rounded-lg border bg-card p-5">
        <header className="mb-4 flex items-start gap-3">
          <span className="rounded-md bg-muted p-2">
            <Printer className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold">{t('receptionQueue:prefs.autoprintTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('receptionQueue:prefs.autoprintHint')}
            </p>
          </div>
        </header>

        <div className="grid gap-2 sm:grid-cols-2">
          <label
            className={
              'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition ' +
              (mode === 'auto'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/40')
            }
          >
            <input
              type="radio"
              name="receipt-mode"
              value="auto"
              checked={mode === 'auto'}
              onChange={() => toggle('auto')}
              className="mt-0.5"
              data-testid="receipt-mode-auto"
            />
            <div>
              <div className="font-medium">{t('receptionQueue:prefs.autoLabel')}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('receptionQueue:prefs.autoDesc')}
              </p>
            </div>
          </label>

          <label
            className={
              'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition ' +
              (mode === 'manual'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/40')
            }
          >
            <input
              type="radio"
              name="receipt-mode"
              value="manual"
              checked={mode === 'manual'}
              onChange={() => toggle('manual')}
              className="mt-0.5"
              data-testid="receipt-mode-manual"
            />
            <div>
              <div className="font-medium">{t('receptionQueue:prefs.manualLabel')}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('receptionQueue:prefs.manualDesc')}
              </p>
            </div>
          </label>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {t('receptionQueue:prefs.deviceScopeHint')}
        </p>
      </section>
    </div>
  );
}
