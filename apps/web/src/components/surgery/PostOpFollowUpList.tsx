import { localeToIntl } from '../../lib/i18n-format';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TRPCClientError } from '@trpc/client';
import { Button } from '../ui/button';
import { trpc } from '../../lib/trpc';
import { useLocale } from '../../providers/LocaleProvider';

interface Props {
  surgeryId: string;
  canEdit: boolean;
}

interface FollowUpRow {
  id: string;
  startsAt: string | Date;
  endsAt: string | Date;
  status: string;
  doctor: { id: string; name: string; specialty: string } | null;
}

export function PostOpFollowUpList({ surgeryId, canEdit }: Props) {
  const { t } = useTranslation(['postOp', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';
  const utils = trpc.useUtils();

  const list = trpc.postOp.listFollowUps.useQuery({ surgeryId });

  const del = trpc.postOp.deleteFollowUps.useMutation({
    onSuccess: async () => {
      toast.success(t('postOp:toast.deleted'));
      await utils.postOp.listFollowUps.invalidate({ surgeryId });
    },
    onError: (err) => {
      const msg = err instanceof TRPCClientError ? err.message : t('postOp:errors.unknown');
      toast.error(msg);
    },
  });

  const items = (list.data as FollowUpRow[] | undefined) ?? [];
  if (items.length === 0) return null;

  const fmtDateTime = (iso: string | Date) => {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    return d.toLocaleString(dateLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="mt-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">
          {t('postOp:section.scheduled', { count: items.length })}
        </span>
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            disabled={del.isPending}
            onClick={() => del.mutate({ surgeryId })}
          >
            {t('postOp:section.clear')}
          </Button>
        )}
      </div>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{fmtDateTime(it.startsAt)}</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5">{it.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
