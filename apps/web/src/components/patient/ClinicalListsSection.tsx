import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Activity, Check, Pill, Plus, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { trpc } from '../../lib/trpc';
import { usePermission } from '../../hooks/usePermission';

// R1 (#723) — Kalıcı klinik problem + ilaç listesi (EHR problem list). Muayene
// tanısı / reçeteden bağımsız, hasta seviyesinde sürekli izlenir. Yazma yetkisi
// action:problemList.manage (klinisyen); okuma tüm hasta-detay erişenleri.

interface ProblemRow {
  id: string;
  description: string;
  icd10: string | null;
  status: string;
}
interface MedicationRow {
  id: string;
  name: string;
  dose: string | null;
  frequency: string | null;
  status: string;
}

export function ClinicalListsSection({ patientId }: { patientId: string }) {
  const { t } = useTranslation(['patient', 'common']);
  const canManage = usePermission('action:problemList.manage');
  const utils = trpc.useUtils();

  const problemsQ = trpc.clinicalList.listProblems.useQuery({ patientId });
  const medsQ = trpc.clinicalList.listMedications.useQuery({ patientId });
  const problems = (problemsQ.data ?? []) as unknown as ProblemRow[];
  const meds = (medsQ.data ?? []) as unknown as MedicationRow[];

  const [problemDesc, setProblemDesc] = useState('');
  const [problemIcd, setProblemIcd] = useState('');
  const [medName, setMedName] = useState('');
  const [medDose, setMedDose] = useState('');
  const [medFreq, setMedFreq] = useState('');

  const onErr = (e: { message: string }) => toast.error(e.message);
  const invProblems = () => utils.clinicalList.listProblems.invalidate({ patientId });
  const invMeds = () => utils.clinicalList.listMedications.invalidate({ patientId });

  const createProblem = trpc.clinicalList.createProblem.useMutation({
    onSuccess: async () => {
      setProblemDesc('');
      setProblemIcd('');
      await invProblems();
    },
    onError: onErr,
  });
  const resolveProblem = trpc.clinicalList.resolveProblem.useMutation({
    onSuccess: invProblems,
    onError: onErr,
  });
  const deleteProblem = trpc.clinicalList.deleteProblem.useMutation({
    onSuccess: invProblems,
    onError: onErr,
  });
  const createMed = trpc.clinicalList.createMedication.useMutation({
    onSuccess: async () => {
      setMedName('');
      setMedDose('');
      setMedFreq('');
      await invMeds();
    },
    onError: onErr,
  });
  const stopMed = trpc.clinicalList.stopMedication.useMutation({
    onSuccess: invMeds,
    onError: onErr,
  });
  const deleteMed = trpc.clinicalList.deleteMedication.useMutation({
    onSuccess: invMeds,
    onError: onErr,
  });

  return (
    <section
      className="grid grid-cols-1 gap-4 lg:grid-cols-2"
      aria-label={t('patient:clinicalLists.title')}
    >
      {/* Problemler */}
      <div className="rounded-xl border bg-background p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Activity className="h-4 w-4" aria-hidden />
          {t('patient:clinicalLists.problems')}
        </h3>
        {problems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('patient:clinicalLists.noProblems')}</p>
        ) : (
          <ul className="space-y-1.5">
            {problems.map((p) => {
              const resolved = p.status === 'resolved';
              return (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span className={cn('flex-1', resolved && 'text-muted-foreground line-through')}>
                    {p.description}
                    {p.icd10 && (
                      <span className="ml-1 text-xs text-muted-foreground">({p.icd10})</span>
                    )}
                  </span>
                  {canManage && !resolved && (
                    <button
                      type="button"
                      title={t('patient:clinicalLists.resolve')}
                      className="text-muted-foreground hover:text-emerald-600"
                      onClick={() => resolveProblem.mutate({ id: p.id })}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      title={t('common:actions.delete')}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => deleteProblem.mutate({ id: p.id })}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canManage && (
          <form
            className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!problemDesc.trim()) return;
              createProblem.mutate({
                patientId,
                description: problemDesc.trim(),
                icd10: problemIcd.trim() || undefined,
              });
            }}
          >
            <Input
              value={problemDesc}
              onChange={(e) => setProblemDesc(e.target.value)}
              placeholder={t('patient:clinicalLists.problemPlaceholder')}
              className="h-9 flex-1 min-w-[10rem]"
              maxLength={300}
            />
            <Input
              value={problemIcd}
              onChange={(e) => setProblemIcd(e.target.value)}
              placeholder="ICD-10"
              className="h-9 w-24"
              maxLength={20}
            />
            <Button
              type="submit"
              size="sm"
              disabled={createProblem.isPending || !problemDesc.trim()}
            >
              <Plus className="mr-1 h-4 w-4" />
              {t('common:actions.add')}
            </Button>
          </form>
        )}
      </div>

      {/* İlaçlar */}
      <div className="rounded-xl border bg-background p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Pill className="h-4 w-4" aria-hidden />
          {t('patient:clinicalLists.medications')}
        </h3>
        {meds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('patient:clinicalLists.noMedications')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {meds.map((m) => {
              const stopped = m.status === 'stopped';
              const detail = [m.dose, m.frequency].filter(Boolean).join(' · ');
              return (
                <li key={m.id} className="flex items-center gap-2 text-sm">
                  <span className={cn('flex-1', stopped && 'text-muted-foreground line-through')}>
                    {m.name}
                    {detail && <span className="ml-1 text-xs text-muted-foreground">{detail}</span>}
                  </span>
                  {canManage && !stopped && (
                    <button
                      type="button"
                      title={t('patient:clinicalLists.stop')}
                      className="text-xs text-muted-foreground hover:text-amber-600"
                      onClick={() => stopMed.mutate({ id: m.id })}
                    >
                      {t('patient:clinicalLists.stop')}
                    </button>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      title={t('common:actions.delete')}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMed.mutate({ id: m.id })}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canManage && (
          <form
            className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!medName.trim()) return;
              createMed.mutate({
                patientId,
                name: medName.trim(),
                dose: medDose.trim() || undefined,
                frequency: medFreq.trim() || undefined,
              });
            }}
          >
            <Input
              value={medName}
              onChange={(e) => setMedName(e.target.value)}
              placeholder={t('patient:clinicalLists.medPlaceholder')}
              className="h-9 flex-1 min-w-[8rem]"
              maxLength={200}
            />
            <Input
              value={medDose}
              onChange={(e) => setMedDose(e.target.value)}
              placeholder={t('patient:clinicalLists.dose')}
              className="h-9 w-20"
              maxLength={80}
            />
            <Input
              value={medFreq}
              onChange={(e) => setMedFreq(e.target.value)}
              placeholder={t('patient:clinicalLists.frequency')}
              className="h-9 w-20"
              maxLength={80}
            />
            <Button type="submit" size="sm" disabled={createMed.isPending || !medName.trim()}>
              <Plus className="mr-1 h-4 w-4" />
              {t('common:actions.add')}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
