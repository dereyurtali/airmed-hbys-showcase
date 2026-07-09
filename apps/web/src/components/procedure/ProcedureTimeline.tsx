import { localeToIntl } from '../../lib/i18n-format';
import { useMemo, useState } from 'react';
import { CalendarCheck, Plus, Syringe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { ProcedureForm } from './ProcedureForm';
import { trpc } from '../../lib/trpc';
import { useLocale } from '../../providers/LocaleProvider';
import type { EyeSide, ProcedureType, ProcedureStatus } from '../../lib/procedure.constants';

interface TimelineItem {
  id: string;
  type: ProcedureType;
  eyeSide: EyeSide;
  status: ProcedureStatus;
  drugUsed: string | null;
  drugDose: string | null;
  performedAt: string | Date;
  complications: string | null;
  doctor: { id: string; name: string; specialty: string };
  followUpAppointment: { id: string; startsAt: string | Date } | null;
}

interface Props {
  patientId: string;
}

export function ProcedureTimeline({ patientId }: Props) {
  const { t } = useTranslation(['procedure', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';

  const me = trpc.auth.me.useQuery();
  const list = trpc.procedure.list.useQuery({ patientId, limit: 50 });
  const doctorList = trpc.doctor.list.useQuery({ page: 1, pageSize: 200, isActive: true });

  const canEdit = (me.data?.roles ?? []).some((r) =>
    ['doktor', 'yonetici', 'yonetici_asistani'].includes(r),
  );

  const [createOpen, setCreateOpen] = useState(false);

  const doctorOptions = useMemo(
    () =>
      (doctorList.data?.items ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        specialty: d.specialty,
      })),
    [doctorList.data?.items],
  );

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

  const items = (list.data ?? []) as unknown as TimelineItem[];

  // Aynı tipte sıralı seans sayısını (IVT serial takip için) hesapla.
  const seriesIndex = useMemo(() => {
    const reversed = items.slice().reverse(); // eskiden yeniye
    const counters: Record<string, number> = {};
    const map = new Map<string, number>();
    for (const p of reversed) {
      counters[p.type] = (counters[p.type] ?? 0) + 1;
      map.set(p.id, counters[p.type]);
    }
    return map;
  }, [items]);

  return (
    <section className="space-y-3" aria-labelledby="procedure-heading">
      <header className="flex items-center justify-between">
        <h2 id="procedure-heading" className="text-lg font-semibold">
          {t('procedure:section.title')}
        </h2>
        {canEdit && me.data && doctorOptions.length > 0 && (
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="procedure-new">
            <Plus className="mr-1 h-4 w-4" />
            {t('procedure:section.newButton')}
          </Button>
        )}
      </header>

      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('procedure:section.loading')}</p>
      ) : list.error ? (
        <p className="rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm text-critical-foreground">
          {list.error.message}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('procedure:section.empty')}</p>
      ) : (
        <ul className="space-y-2" data-testid="procedure-list">
          {items.map((p) => {
            const seriesNum = seriesIndex.get(p.id) ?? 1;
            return (
              <li key={p.id} className="rounded-lg border bg-card p-3 text-sm">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <Syringe
                      className="mt-0.5 h-4 w-4 text-muted-foreground flex-shrink-0"
                      aria-hidden
                    />
                    <div>
                      <div className="font-medium">
                        {t(`procedure:types.${p.type as ProcedureType}`)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          #{seriesNum} · {t(`procedure:eyeSide.${p.eyeSide}`)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDateTime(p.performedAt)} · {p.doctor.name}
                      </div>
                      {p.drugUsed && (
                        <div className="text-xs">
                          <span className="text-muted-foreground">
                            {t('procedure:form.fields.drugUsed')}:
                          </span>{' '}
                          {p.drugUsed}
                          {p.drugDose ? ` (${p.drugDose})` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="rounded-badge bg-muted px-2 py-0.5 text-xs">
                    {t(`procedure:status.${p.status}`)}
                  </span>
                </div>
                {p.followUpAppointment && (
                  <div className="mt-2 flex items-center gap-1 rounded-lg border border-success-border bg-success-bg px-2 py-1 text-xs text-success-foreground">
                    <CalendarCheck className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                    <span>
                      {t('procedure:list.followUp', {
                        date: fmtDateTime(p.followUpAppointment.startsAt),
                      })}
                    </span>
                  </div>
                )}
                {p.complications && (
                  <p className="mt-1 text-xs text-warning-foreground">
                    {t('procedure:form.fields.complications')}: {p.complications}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {createOpen && me.data && (
        <ProcedureForm
          open={createOpen}
          onOpenChange={setCreateOpen}
          patientId={patientId}
          doctors={doctorOptions}
          onSaved={() => setCreateOpen(false)}
        />
      )}
    </section>
  );
}
