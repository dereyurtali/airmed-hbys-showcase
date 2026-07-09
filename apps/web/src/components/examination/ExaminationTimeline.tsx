import { localeToIntl } from '../../lib/i18n-format';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { ExaminationForm, type ExistingExamination } from './ExaminationForm';
import { FindingsView } from './FindingsView';
import { type ExaminationFindings } from '../../lib/examination.constants';
import { trpc } from '../../lib/trpc';
import { useLocale } from '../../providers/LocaleProvider';

interface TimelineItem {
  id: string;
  examinedAt: string | Date;
  doctor: { id: string; name: string; email: string };
  chiefComplaint: string | null;
  history: string | null;
  findings: unknown;
  diagnosis: string | null;
  treatmentPlan: string | null;
  prescription: string | null;
}

function toExisting(exam: TimelineItem): ExistingExamination {
  return {
    id: exam.id,
    examinedAt: new Date(exam.examinedAt),
    chiefComplaint: exam.chiefComplaint,
    history: exam.history,
    findings: (exam.findings as ExaminationFindings) ?? {},
    diagnosis: exam.diagnosis,
    treatmentPlan: exam.treatmentPlan,
    prescription: exam.prescription,
  };
}

interface Props {
  patientId: string;
}

export function ExaminationTimeline({ patientId }: Props) {
  const { t } = useTranslation(['examination', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';

  const me = trpc.auth.me.useQuery();
  const list = trpc.examination.listByPatient.useQuery({ patientId });

  const canEdit = (me.data?.roles ?? []).some((r) =>
    ['doktor', 'yonetici', 'yonetici_asistani'].includes(r),
  );
  const isAdmin = (me.data?.roles ?? []).includes('yonetici');

  // R1 (#723) — "Bitir+Reçete tek hamle": hasta şu an muayenede (in_exam) ise
  // create formuna aktif ziyaret id'sini geçir → "Kaydet + Muayeneyi Bitir".
  const activeEncounter = trpc.encounter.activeForPatient.useQuery(
    { patientId },
    { enabled: canEdit },
  );
  const active = activeEncounter.data as { id: string; stage: string } | null | undefined;
  const activeExamEncounterId = active?.stage === 'in_exam' ? active.id : null;

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ExistingExamination | null>(null);

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

  const isEditable = (examinedAt: string | Date) => {
    if (isAdmin) return true;
    const ageMs = Date.now() - new Date(examinedAt).getTime();
    return ageMs < 24 * 60 * 60 * 1000;
  };

  return (
    <section className="space-y-3" aria-labelledby="examination-heading">
      <header className="flex items-center justify-between">
        <h2 id="examination-heading" className="text-lg font-semibold">
          {t('examination:section.title')}
        </h2>
        {canEdit && me.data && (
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="examination-new">
            <Plus className="mr-1 h-4 w-4" />
            {t('examination:section.newButton')}
          </Button>
        )}
      </header>

      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('examination:section.loading')}</p>
      ) : list.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {list.error.message}
        </p>
      ) : !list.data || list.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('examination:section.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {/* #723 — bileşene ikinci tRPC query eklenince inference derinliği TS2589'u
              tetikledi; çift-cast (as unknown as) deep instantiation'ı keser (WorklistPage deseni). */}
          {(list.data as unknown as TimelineItem[]).map((exam) => {
            const editable = canEdit && isEditable(exam.examinedAt);
            return (
              <li key={exam.id} className="rounded-md border bg-card p-3 text-sm">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{fmtDateTime(exam.examinedAt)}</div>
                    <div className="text-xs text-muted-foreground">{exam.doctor.name}</div>
                  </div>
                  {editable && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(toExisting(exam))}
                    >
                      {t('common:actions.edit')}
                    </Button>
                  )}
                </div>
                {exam.diagnosis && (
                  <div>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t('examination:form.fields.diagnosis')}:
                    </span>{' '}
                    <span>{exam.diagnosis}</span>
                  </div>
                )}
                {exam.chiefComplaint && (
                  <div className="text-xs text-muted-foreground">
                    {t('examination:form.fields.chiefComplaint')}: {exam.chiefComplaint}
                  </div>
                )}
                {/* #388 — klinik bulgular (VA OD/OS, ön segment, fundus) okunur. */}
                <FindingsView
                  findings={(exam.findings as ExaminationFindings) ?? {}}
                  className="mt-2"
                />
                <IcdChips findings={(exam.findings as ExaminationFindings) ?? {}} />
              </li>
            );
          })}
        </ul>
      )}

      {createOpen && me.data && (
        <ExaminationForm
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="create"
          patientId={patientId}
          doctorUserId={me.data.sub}
          activeEncounterId={activeExamEncounterId}
          onSaved={() => setCreateOpen(false)}
        />
      )}

      {editing && me.data && (
        <ExaminationForm
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          mode="edit"
          patientId={patientId}
          doctorUserId={me.data.sub}
          existing={editing}
          onSaved={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function IcdChips({ findings }: { findings: ExaminationFindings }) {
  const codes = (findings as { icd10?: string[] } | null)?.icd10 ?? [];
  if (!Array.isArray(codes) || codes.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {codes.map((code) => (
        <span
          key={code}
          className="inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-900"
        >
          {code}
        </span>
      ))}
    </div>
  );
}
