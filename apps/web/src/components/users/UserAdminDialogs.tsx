import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { Copy, Loader2, ShieldAlert } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';

// #1050 — AdminUsersPage + UserDetailPage ortak parçaları. Şifre reveal ve
// onay diyalogları iki ekranda da aynı davranır; tek kaynaktan yaşasın diye
// AdminUsersPage'ten buraya taşındı.

export const USER_STATUSES = ['active', 'inactive', 'locked', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_LOCALES = ['tr', 'ru', 'tg'] as const;
export type UserLocale = (typeof USER_LOCALES)[number];

export type UserConfirmKind = 'resetPassword' | 'deactivate' | 'reactivate';

/** Onay diyaloğunun ihtiyacı olan minimum kullanıcı bilgisi. */
export interface UserSummary {
  id: string;
  email: string;
  name: string;
}

export function extractErr(err: unknown, fallback: string): string {
  if (err instanceof TRPCClientError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const { t } = useTranslation('common');
  // Bölüm 24 — durum = semantik Badge variant (tint + kenar + metin):
  // active → success · locked/suspended → critical · inactive → secondary · diğer → outline.
  const variant =
    status === 'active'
      ? 'success'
      : status === 'locked' || status === 'suspended'
        ? 'critical'
        : status === 'inactive'
          ? 'secondary'
          : 'outline';
  return <Badge variant={variant}>{t(`usersPage.status.${status}`)}</Badge>;
}

// ---------------------------------------------------------------------------
// Password reveal (post-create + post-reset)
// ---------------------------------------------------------------------------

export function PasswordRevealDialog({
  data,
  onClose,
}: {
  data: { email: string; password: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!data) setCopied(false);
  }, [data]);

  if (!data) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.password);
      setCopied(true);
      toast.success(t('usersPage.toast.copied'));
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error(t('usersPage.password.copyFailed'));
    }
  };

  return (
    <Dialog open={!!data} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-full max-w-md p-6" data-testid="password-reveal">
        <div className="space-y-1.5 mb-4">
          <DialogTitle>{t('usersPage.password.title')}</DialogTitle>
          <DialogDescription>{t('usersPage.password.description')}</DialogDescription>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {t('usersPage.password.userLabel')}
            </p>
            <p className="font-medium">{data.email}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {t('usersPage.password.passwordLabel')}
            </p>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 rounded-lg border bg-muted px-3 py-2 font-mono text-base tracking-wider"
                data-testid="password-value"
              >
                {data.password}
              </code>
              <Button type="button" variant="outline" onClick={copy} aria-live="polite">
                <Copy className="mr-2 h-4 w-4" aria-hidden />
                {copied ? t('usersPage.password.copied') : t('usersPage.password.copy')}
              </Button>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-critical-border bg-critical-bg p-3 text-sm text-critical-foreground">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{t('usersPage.password.warning')}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-row justify-end gap-2">
          <Button onClick={onClose}>{t('usersPage.password.close')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog (reset / deactivate / reactivate)
// ---------------------------------------------------------------------------

export function UserConfirmDialog({
  state,
  onClose,
  onResetPassword,
  onDeactivate,
  onReactivate,
  loading,
}: {
  state: { kind: UserConfirmKind; user: UserSummary } | null;
  onClose: () => void;
  onResetPassword: (id: string) => Promise<unknown>;
  onDeactivate: (id: string) => Promise<unknown>;
  onReactivate: (id: string) => Promise<unknown>;
  loading: boolean;
}) {
  const { t } = useTranslation('common');
  if (!state) return null;

  const { kind, user } = state;
  const i18nBase = `usersPage.confirm.${kind}`;
  const destructive = kind === 'deactivate';

  const run = () => {
    if (kind === 'resetPassword') return onResetPassword(user.id);
    if (kind === 'deactivate') return onDeactivate(user.id);
    return onReactivate(user.id);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-full max-w-md p-6">
        <div className="space-y-1.5 mb-4">
          <DialogTitle>{t(`${i18nBase}.title`)}</DialogTitle>
          <DialogDescription>
            {t(`${i18nBase}.description`, { email: user.email, name: user.name })}
          </DialogDescription>
        </div>
        <div className="mt-4 flex flex-row justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {t('usersPage.confirm.cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => void run()}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {t(`${i18nBase}.submit`)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
