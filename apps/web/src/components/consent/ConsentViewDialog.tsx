import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { useLocale } from '../../providers/LocaleProvider';
import { formatDateTime } from '../../lib/i18n-format';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signing: {
    id: string;
    contentSnapshot: string;
    signatureData: string;
    signedAt: string;
    witnessName: string | null;
    revokedAt: string | null;
    revokeReason: string | null;
    language: string;
    template: { title: string; version: number; procedureType: string };
    signedBy: { id: string; name: string } | null;
  };
}

export function ConsentViewDialog({ open, onOpenChange, signing }: Props) {
  const { t } = useTranslation(['consent', 'common']);
  const { locale } = useLocale();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogTitle>{signing.template.title}</DialogTitle>
        <DialogDescription>
          {t(`consent:procedure.${signing.template.procedureType}`)} ·{' '}
          {signing.language.toUpperCase()} · v{signing.template.version}
        </DialogDescription>

        {signing.revokedAt && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <strong>{t('consent:section.revoked')}:</strong> {signing.revokeReason}
          </div>
        )}

        <section className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">{t('consent:view.content')}</h3>
          <div
            className="whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm"
            data-testid="consent-view-content"
          >
            {signing.contentSnapshot}
          </div>
        </section>

        <section className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
          <div>
            <span className="text-muted-foreground">{t('consent:view.signedAt')}:</span>{' '}
            {formatDateTime(signing.signedAt, locale)}
          </div>
          {signing.signedBy && (
            <div>
              <span className="text-muted-foreground">{t('consent:view.signedBy')}:</span>{' '}
              {signing.signedBy.name}
            </div>
          )}
          {signing.witnessName && (
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">{t('consent:view.witness')}:</span>{' '}
              {signing.witnessName}
            </div>
          )}
        </section>

        <section className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">{t('consent:view.signature')}</h3>
          <img
            src={signing.signatureData}
            alt="Signature"
            className="rounded-md border bg-white p-2"
            style={{ maxWidth: 600 }}
            data-testid="consent-view-signature"
          />
        </section>

        <div className="mt-4 flex justify-end">
          <Button onClick={() => onOpenChange(false)}>{t('common:actions.close')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
