import { localeToIntl } from '../../lib/i18n-format';
import { useState } from 'react';
import { FileSignature, RotateCcw, ShieldCheck } from 'lucide-react';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { usePermissions } from '../../hooks/usePermission';
import { trpc } from '../../lib/trpc';
import { useLocale } from '../../providers/LocaleProvider';
import { ConsentSignDialog } from './ConsentSignDialog';
import { ConsentViewDialog } from './ConsentViewDialog';

interface Props {
  patientId: string;
}

interface SigningRow {
  id: string;
  templateId: string;
  patientId: string;
  surgeryId: string | null;
  language: 'tr' | 'ru' | 'tg';
  contentSnapshot: string;
  signatureData: string;
  signedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  witnessName: string | null;
  template: { id: string; procedureType: string; language: string; version: number; title: string };
  signedBy: { id: string; name: string } | null;
}

export function ConsentsSection({ patientId }: Props) {
  const { t } = useTranslation(['consent', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';
  const utils = trpc.useUtils();

  // S10a — Permission registry (P1 #3.31): hardcode role check kaldırıldı.
  // Bonus P1 #3.15: trpc.auth.me.useQuery dedup (auth context'ten roles geliyor).
  // canSign onam imzası capture (Karar 3: hemşire dahil); isAdmin şablon yönetimi.
  const can = usePermissions(['action:consent.capture', 'action:consentTemplate.manage']);
  const canSign = can['action:consent.capture'];
  const isAdmin = can['action:consentTemplate.manage'];

  const [showRevoked, setShowRevoked] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [viewing, setViewing] = useState<SigningRow | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const list = trpc.consent.listByPatient.useQuery({
    patientId,
    includeRevoked: showRevoked,
  });

  const revoke = trpc.consent.revoke.useMutation({
    onSuccess: async () => {
      toast.success(t('consent:toast.revoked'));
      setRevokingId(null);
      setRevokeReason('');
      await utils.consent.listByPatient.invalidate({ patientId });
    },
    onError: (err) =>
      toast.error(err instanceof TRPCClientError ? err.message : t('consent:errors.unknown')),
  });

  const items = (list.data as SigningRow[] | undefined) ?? [];

  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString(dateLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <section
      className="space-y-3 rounded-md border bg-background p-6"
      aria-labelledby="consent-heading"
    >
      <header className="flex items-center justify-between">
        <h2 id="consent-heading" className="text-lg font-semibold">
          {t('consent:section.title')}
        </h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showRevoked}
              onChange={(e) => setShowRevoked(e.target.checked)}
              data-testid="consent-show-revoked"
            />
            {t('consent:section.showRevoked')}
          </label>
          {canSign && (
            <Button size="sm" onClick={() => setSignOpen(true)} data-testid="consent-sign-open">
              <FileSignature className="mr-1 h-4 w-4" />
              {t('consent:section.signButton')}
            </Button>
          )}
        </div>
      </header>

      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('common:loading')}</p>
      ) : list.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {list.error.message}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('consent:section.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const isRevoked = !!it.revokedAt;
            return (
              <li
                key={it.id}
                className={`rounded-md border px-3 py-2 text-sm ${
                  isRevoked ? 'border-amber-300 bg-amber-50' : 'bg-card'
                }`}
                data-testid={`consent-row-${it.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-medium">
                      {it.template.title}{' '}
                      <span className="text-xs text-muted-foreground">
                        ({t(`consent:procedure.${it.template.procedureType}`)} ·{' '}
                        {it.language.toUpperCase()} · v{it.template.version})
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDateTime(it.signedAt)}
                      {it.signedBy && <> · {it.signedBy.name}</>}
                      {it.witnessName && (
                        <>
                          {' '}
                          · {t('consent:section.witness')}: {it.witnessName}
                        </>
                      )}
                    </div>
                    {isRevoked && (
                      <div className="text-xs text-amber-900">
                        <RotateCcw className="mr-1 inline h-3 w-3" />
                        {t('consent:section.revoked')}: {it.revokeReason}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => setViewing(it)}
                      data-testid={`consent-view-${it.id}`}
                    >
                      <ShieldCheck className="mr-1 h-3 w-3" />
                      {t('consent:section.view')}
                    </Button>
                    {isAdmin && !isRevoked && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => setRevokingId(it.id)}
                        data-testid={`consent-revoke-${it.id}`}
                      >
                        {t('consent:section.revoke')}
                      </Button>
                    )}
                  </div>
                </div>
                {revokingId === it.id && (
                  <div className="mt-2 space-y-2 rounded-md border bg-muted/40 p-2">
                    <label className="block text-xs font-medium">
                      {t('consent:revoke.reasonLabel')}
                    </label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                      rows={2}
                      maxLength={500}
                      value={revokeReason}
                      onChange={(e) => setRevokeReason(e.target.value)}
                    />
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          setRevokingId(null);
                          setRevokeReason('');
                        }}
                      >
                        {t('common:actions.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 px-2 text-xs"
                        disabled={revokeReason.trim().length < 3 || revoke.isPending}
                        onClick={() =>
                          revoke.mutate({ signingId: it.id, reason: revokeReason.trim() })
                        }
                      >
                        {t('consent:revoke.submit')}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {signOpen && (
        <ConsentSignDialog
          open={signOpen}
          onOpenChange={setSignOpen}
          patientId={patientId}
          onSigned={() => {
            setSignOpen(false);
            void utils.consent.listByPatient.invalidate({ patientId });
          }}
        />
      )}

      {viewing && (
        <ConsentViewDialog
          open={!!viewing}
          onOpenChange={(open) => !open && setViewing(null)}
          signing={viewing}
        />
      )}
    </section>
  );
}
