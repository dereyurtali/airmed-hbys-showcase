import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Download } from 'lucide-react';
import { CenteredCard } from '../components/CenteredCard';
import { Alert, Button } from '../components/ui';
import { ApiError } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';

/**
 * One-shot TOTP setup. Server generates the secret + 10 recovery codes
 * exactly once; if the user navigates away before checking the box, the
 * codes are gone. We make that explicit with a checkbox-gated Continue.
 */
export function SetupTotpPage() {
  const { state, setupTotp } = usePlatformAuth();
  const navigate = useNavigate();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (state.status !== 'challenge') return;
    if (!state.needsTotpSetup) return;
    if (state.pendingSecret) return; // already fetched
    let cancelled = false;
    setLoading(true);
    setupTotp()
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : t('auth.setupStartError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Run once on mount: setupTotp is the intentional one-shot call.
  }, []);

  if (state.status === 'logged_out') return <Navigate to="/login" replace />;
  if (state.status === 'authenticated') return <Navigate to="/" replace />;
  if (state.status === 'bootstrapping') return null;
  if (!state.needsTotpSetup && !state.pendingSecret) {
    return <Navigate to="/verify-totp" replace />;
  }

  if (loading || !state.pendingOtpauthUrl || !state.pendingSecret) {
    return (
      <CenteredCard title={t('auth.setupGenTitle')} subtitle={t('auth.setupGenSubtitle')}>
        {error && <Alert tone="error">{error}</Alert>}
      </CenteredCard>
    );
  }

  const downloadCodes = () => {
    const text = (state.pendingRecoveryCodes ?? []).join('\n');
    const blob = new Blob(
      [
        `AirMed-HBYS Platform — Recovery codes\n\n` +
          text +
          '\n\nHer kod tek seferlik. Kaybolursa platform_owner ile manuel reset gerekir.\n',
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'airmed-platform-recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copySecret = async () => {
    if (state.pendingSecret) await navigator.clipboard.writeText(state.pendingSecret);
  };

  return (
    <CenteredCard title={t('auth.setupTitle')} subtitle={t('auth.setupSubtitle')}>
      <div className="space-y-5">
        <div className="flex justify-center rounded-lg border border-border bg-white p-4">
          <QRCodeSVG value={state.pendingOtpauthUrl} size={180} level="M" />
        </div>

        <div className="space-y-1.5">
          <span className="block text-[13px] font-semibold text-foreground">
            {t('auth.manualKey')}
          </span>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={state.pendingSecret}
              className="focus-ring h-10 w-full rounded-lg border border-input bg-[var(--ro)] px-3 font-mono text-sm text-foreground"
            />
            <Button type="button" variant="ghost" size="md" onClick={copySecret}>
              <Copy className="h-4 w-4" aria-hidden />
              {t('auth.copy')}
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-[13px] font-semibold text-foreground">
            {t('auth.recoveryCodesLabel')}
          </span>
          <pre
            className="m-0 whitespace-pre-wrap rounded-lg border border-border bg-[var(--ro)] p-3 font-mono text-[13px] text-foreground"
            data-testid="platform-recovery-codes"
          >
            {(state.pendingRecoveryCodes ?? []).join('\n')}
          </pre>
          <Button type="button" variant="ghost" size="sm" onClick={downloadCodes}>
            <Download className="h-4 w-4" aria-hidden />
            {t('auth.downloadTxt')}
          </Button>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-[13px] text-muted-foreground">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#0166A8]"
            data-testid="platform-recovery-ack"
          />
          <span>{t('auth.setupAck')}</span>
        </label>

        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={!acknowledged}
          onClick={() => navigate('/verify-totp', { replace: true })}
          data-testid="platform-recovery-continue"
        >
          {t('auth.setupContinue')}
        </Button>
      </div>
    </CenteredCard>
  );
}
