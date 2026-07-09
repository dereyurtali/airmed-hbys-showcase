import { localeToIntl } from '../../lib/i18n-format';
import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarPlus, Plus, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { SurgeryForm, type ExistingSurgery } from './SurgeryForm';
import { PostOpFollowUpDialog } from './PostOpFollowUpDialog';
import { PostOpFollowUpList } from './PostOpFollowUpList';
import { PreOpPanel } from './PreOpPanel';
import { SafetyChecklistPanel } from './SafetyChecklistPanel';
import {
  isWithinSameDayWindow,
  type SurgeryIntraOp,
  type SurgeryPostOp,
  type SurgeryPreOp,
  type SurgeryStatus,
} from '../../lib/surgery.constants';
import { trpc } from '../../lib/trpc';
import { usePermission } from '../../hooks/usePermission';
import { useLocale } from '../../providers/LocaleProvider';

interface TimelineItem {
  id: string;
  type: string;
  status: string;
  scheduledAt: string | Date;
  performedAt: string | Date | null;
  doctor: { id: string; name: string; specialty: string; userId: string | null };
  preOp: unknown;
  intraOp: unknown;
  postOp: unknown;
  complicationFlag: boolean;
  complicationNotes: string | null;
}

function toExisting(s: TimelineItem): ExistingSurgery {
  return {
    id: s.id,
    type: s.type,
    doctorId: s.doctor.id,
    status: s.status as SurgeryStatus,
    scheduledAt: new Date(s.scheduledAt),
    performedAt: s.performedAt ? new Date(s.performedAt) : null,
    preOp: (s.preOp as SurgeryPreOp) ?? {},
    intraOp: (s.intraOp as SurgeryIntraOp) ?? {},
    postOp: (s.postOp as SurgeryPostOp) ?? {},
    complicationFlag: s.complicationFlag,
    complicationNotes: s.complicationNotes,
  };
}

interface Props {
  patientId: string;
}

export function SurgeryTimeline({ patientId }: Props) {
  const { t } = useTranslation(['surgery', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';

  const me = trpc.auth.me.useQuery();
  const list = trpc.surgery.listByPatient.useQuery({ patientId });
  // Doktor diğer doktorları listeleyemez; cerrah seçimi için yalnız kendi profili.
  const canListDoctors = usePermission('action:doctor.list');
  const doctorList = trpc.doctor.list.useQuery(
    { page: 1, pageSize: 200, isActive: true },
    { enabled: canListDoctors },
  );
  const myProfile = trpc.doctor.myProfile.useQuery(undefined, { enabled: !canListDoctors });

  const canEdit = (me.data?.roles ?? []).some((r) =>
    ['doktor', 'yonetici', 'yonetici_asistani'].includes(r),
  );
  const isAdmin = (me.data?.roles ?? []).includes('yonetici');
  const myUserId = me.data?.sub;

  const doctorOptions = useMemo(() => {
    if (canListDoctors) {
      return (doctorList.data?.items ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        specialty: d.specialty,
      }));
    }
    // Doktor: cerrah = kendisi (tek seçenek).
    return myProfile.data
      ? [{ id: myProfile.data.id, name: myProfile.data.name, specialty: myProfile.data.specialty }]
      : [];
  }, [canListDoctors, doctorList.data?.items, myProfile.data]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ExistingSurgery | null>(null);
  const [followUpDialog, setFollowUpDialog] = useState<{
    surgeryId: string;
    performedAt: Date;
  } | null>(null);
  const [safetyDialog, setSafetyDialog] = useState<string | null>(null);

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

  const isEditable = (s: TimelineItem): boolean => {
    if (isAdmin) return true;
    if (!s.doctor.userId || !myUserId) return false;
    if (s.doctor.userId !== myUserId) return false;
    return isWithinSameDayWindow(s.performedAt ? new Date(s.performedAt) : null);
  };

  return (
    <section className="space-y-3" aria-labelledby="surgery-heading">
      <header className="flex items-center justify-between">
        <h2 id="surgery-heading" className="text-lg font-semibold">
          {t('surgery:section.title')}
        </h2>
        {canEdit && me.data && doctorOptions.length > 0 && (
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="surgery-new">
            <Plus className="mr-1 h-4 w-4" />
            {t('surgery:section.newButton')}
          </Button>
        )}
      </header>

      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('surgery:section.loading')}</p>
      ) : list.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {list.error.message}
        </p>
      ) : !list.data || list.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('surgery:section.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {(list.data as TimelineItem[]).map((s) => {
            const editable = canEdit && isEditable(s);
            return (
              <li key={s.id} className="rounded-lg border bg-card p-3 text-sm">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{s.type}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDateTime(s.scheduledAt)} · {s.doctor.name}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{t(`surgery:status.${s.status}`)}</Badge>
                    {editable && (
                      <Button size="sm" variant="outline" onClick={() => setEditing(toExisting(s))}>
                        {t('common:actions.edit')}
                      </Button>
                    )}
                  </div>
                </div>
                {s.complicationFlag && (
                  <div className="mt-1 flex items-start gap-1 rounded-lg border border-warning-border bg-warning-bg px-2 py-1 text-xs text-warning-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                    <span>{s.complicationNotes ?? t('surgery:form.fields.complicationFlag')}</span>
                  </div>
                )}
                {!s.performedAt && s.status !== 'cancelled' && (
                  <PreOpPanel surgeryId={s.id} canEdit={canEdit} isAdmin={isAdmin} />
                )}
                {/* S15-PR3 — WHO Safety Checklist button (planlanmış/yapılmış her
                    cerrahide görünür; PR9'da SurgeryDayCenterPage'e taşınır). */}
                {s.status !== 'cancelled' && (
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => setSafetyDialog(s.id)}>
                      <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                      {t('safety:title', { defaultValue: 'Güvenlik Kontrolü' })}
                    </Button>
                  </div>
                )}
                {s.performedAt && <PostOpFollowUpList surgeryId={s.id} canEdit={canEdit} />}
                {s.performedAt && canEdit && (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setFollowUpDialog({
                          surgeryId: s.id,
                          performedAt: new Date(s.performedAt as string),
                        })
                      }
                    >
                      <CalendarPlus className="mr-1 h-3.5 w-3.5" />
                      {t('postOp:section.planButton')}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {createOpen && me.data && (
        <SurgeryForm
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="create"
          patientId={patientId}
          doctors={doctorOptions}
          onSaved={() => setCreateOpen(false)}
        />
      )}

      {editing && me.data && (
        <SurgeryForm
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          mode="edit"
          patientId={patientId}
          doctors={doctorOptions}
          existing={editing}
          onSaved={() => setEditing(null)}
        />
      )}

      {followUpDialog && (
        <PostOpFollowUpDialog
          open={!!followUpDialog}
          onOpenChange={(open) => !open && setFollowUpDialog(null)}
          surgeryId={followUpDialog.surgeryId}
          performedAt={followUpDialog.performedAt}
          onScheduled={() => setFollowUpDialog(null)}
        />
      )}

      {safetyDialog && (
        <Dialog open={!!safetyDialog} onOpenChange={(o) => !o && setSafetyDialog(null)}>
          <DialogContent className="max-w-2xl">
            <DialogTitle>{t('safety:title')}</DialogTitle>
            <SafetyChecklistPanel surgeryId={safetyDialog} />
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
