import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DateTimeField } from '../ui/date-field';
import { Label } from '../ui/label';
import { type ExaminationFindings, FINDINGS_FIELDS } from '../../lib/examination.constants';
import { trpc } from '../../lib/trpc';
import { IcdCodePicker } from './IcdCodePicker';
import { useUnsavedWarning, confirmIfDirty } from '../../hooks/useUnsavedWarning';

type Mode = 'create' | 'edit';

export interface ExistingExamination {
  id: string;
  examinedAt: Date;
  chiefComplaint: string | null;
  history: string | null;
  findings: ExaminationFindings;
  diagnosis: string | null;
  treatmentPlan: string | null;
  prescription: string | null;
}

// #379 — openDraft query'sinin döndürdüğü kaydın form için gereken alt kümesi
// (tRPC'nin tam Prisma row inference'i prefill effect'inde TS2589 tetikliyor).
interface DraftExamination {
  id: string;
  examinedAt: string | Date;
  chiefComplaint: string | null;
  history: string | null;
  findings: unknown;
  diagnosis: string | null;
  treatmentPlan: string | null;
  prescription: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: Mode;
  patientId: string;
  doctorUserId: string; // current user.id (yonetici de kendi adına yazar; başkası adına = ileri faz)
  existing?: ExistingExamination | null;
  onSaved: () => void;
  // R1 (Karar/UX #723) — "Bitir+Reçete tek hamle". Hastanın aktif in_exam
  // ziyaretinin id'si verilirse create modunda birincil aksiyon "Kaydet +
  // Muayeneyi Bitir" olur: muayene final kaydedilir + encounter done'a
  // ilerletilir (4-6 etkileşim → 1). Verilmezse klasik tek "Kaydet".
  activeEncounterId?: string | null;
}

function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ExaminationForm({
  open,
  onOpenChange,
  mode = 'create',
  patientId,
  doctorUserId,
  existing,
  onSaved,
  activeEncounterId,
}: Props) {
  const { t } = useTranslation(['examination', 'common']);
  const utils = trpc.useUtils();
  const isEdit = mode === 'edit';
  // R1 (#723) — tek-hamle bitir yalnız create modunda + aktif in_exam ziyaret varken.
  const canFinish = !isEdit && !!activeEncounterId;

  const [examinedAt, setExaminedAt] = useState(toDateTimeLocal(new Date()));
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [history, setHistory] = useState('');
  const [findings, setFindings] = useState<ExaminationFindings>({});
  const [diagnosis, setDiagnosis] = useState('');
  const [icd10, setIcd10] = useState<string[]>([]);
  const [treatmentPlan, setTreatmentPlan] = useState('');
  const [prescription, setPrescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  // #379 — taslak akışı: create modunda kaydedilen/yüklenen taslağın id'si.
  // Set ise sonraki taslak-kaydet ve final "Kaydet" aynı kaydı günceller.
  const [draftId, setDraftId] = useState<string | null>(null);

  // SİS-8 — Açılış snapshot'ı; sonra alanlar değiştiyse "dirty".
  const initialRef = useRef('');
  const justSubmittedRef = useRef(false);
  const snapshot = JSON.stringify({
    examinedAt,
    chiefComplaint,
    history,
    findings,
    diagnosis,
    icd10,
    treatmentPlan,
    prescription,
  });
  const dirty = !justSubmittedRef.current && snapshot !== initialRef.current;

  // #379 — create modunda hastanın açık taslağını yükle. Sadece açılışta bir kez
  // prefill et (kullanıcının yazdığını ezmemek için draftLoadedRef ile guard).
  const draftLoadedRef = useRef(false);
  const draftQuery = trpc.examination.openDraft.useQuery(
    { patientId },
    { enabled: open && !isEdit },
  );

  useEffect(() => {
    if (!open) return;
    justSubmittedRef.current = false;
    draftLoadedRef.current = false;
    setDraftId(null);
    let snap: string;
    if (isEdit && existing) {
      const codes = (existing.findings as { icd10?: string[] } | null)?.icd10 ?? [];
      const codeList = Array.isArray(codes) ? codes : [];
      setExaminedAt(toDateTimeLocal(existing.examinedAt));
      setChiefComplaint(existing.chiefComplaint ?? '');
      setHistory(existing.history ?? '');
      setFindings(existing.findings ?? {});
      setDiagnosis(existing.diagnosis ?? '');
      setTreatmentPlan(existing.treatmentPlan ?? '');
      setPrescription(existing.prescription ?? '');
      setIcd10(codeList);
      snap = JSON.stringify({
        examinedAt: toDateTimeLocal(existing.examinedAt),
        chiefComplaint: existing.chiefComplaint ?? '',
        history: existing.history ?? '',
        findings: existing.findings ?? {},
        diagnosis: existing.diagnosis ?? '',
        icd10: codeList,
        treatmentPlan: existing.treatmentPlan ?? '',
        prescription: existing.prescription ?? '',
      });
    } else {
      const now = toDateTimeLocal(new Date());
      setExaminedAt(now);
      setChiefComplaint('');
      setHistory('');
      setFindings({});
      setDiagnosis('');
      setTreatmentPlan('');
      setPrescription('');
      setIcd10([]);
      snap = JSON.stringify({
        examinedAt: now,
        chiefComplaint: '',
        history: '',
        findings: {},
        diagnosis: '',
        icd10: [],
        treatmentPlan: '',
        prescription: '',
      });
    }
    initialRef.current = snap;
    setFormError(null);
  }, [open, isEdit, existing]);

  // #379 — açık taslak yüklenince formu doldur (yalnız açılışta bir kez). Kullanıcı
  // aktif yazarken ezmemek için draftLoadedRef guard'ı; sonraki render'larda atlanır.
  // Lean cast: tRPC'nin tam Prisma row tipi TS2589 (deep instantiation) tetikliyor.
  const draft = draftQuery.data as DraftExamination | null | undefined;
  useEffect(() => {
    if (!open || isEdit || draftLoadedRef.current || !draft) return;
    draftLoadedRef.current = true;
    const codes = (draft.findings as { icd10?: string[] } | null)?.icd10 ?? [];
    const codeList = Array.isArray(codes) ? codes : [];
    setExaminedAt(toDateTimeLocal(new Date(draft.examinedAt)));
    setChiefComplaint(draft.chiefComplaint ?? '');
    setHistory(draft.history ?? '');
    setFindings((draft.findings as ExaminationFindings) ?? {});
    setDiagnosis(draft.diagnosis ?? '');
    setTreatmentPlan(draft.treatmentPlan ?? '');
    setPrescription(draft.prescription ?? '');
    setIcd10(codeList);
    setDraftId(draft.id);
  }, [open, isEdit, draft]);

  const handleError = (err: unknown) => {
    let msg = t('examination:errors.unknown');
    if (err instanceof TRPCClientError) {
      const raw = err.message;
      if (raw.includes('Same-day edit window expired')) {
        msg = t('examination:errors.sameDayExpired');
      } else if (raw.includes('Only the examining doctor or yonetici')) {
        msg = t('examination:errors.onlyOwnerOrAdmin');
      } else {
        msg = raw;
      }
    }
    setFormError(msg);
    toast.error(msg);
  };

  // #379 — son mutation taslak kaydetme miydi? draft ise toast + form açık kalır
  // (kapatma/navigasyon yok); final ise eski "kaydet" davranışı (kapat + onSaved).
  const draftSaveRef = useRef(false);
  // R1 (#723) — son final-save sonrası muayeneyi bitir (encounter done) mi?
  const finishRef = useRef(false);

  // R1 (#723) — muayene final kaydedildikten sonra aktif ziyareti done'a kapat.
  // Best-effort: kayıt başarılı; ziyaret kapatma hatası kaydı geçersiz kılmaz,
  // yalnız uyarı (doktor worklist'ten "Tamamla" ile manuel kapatabilir).
  const closeEncounter = trpc.encounter.close.useMutation();
  const finalizeAfterSave = async () => {
    if (finishRef.current && activeEncounterId) {
      try {
        await closeEncounter.mutateAsync({ id: activeEncounterId });
        await Promise.all([
          utils.encounter.myWorklist.invalidate(),
          utils.encounter.activeForPatient.invalidate({ patientId }),
          utils.encounter.myActiveExamCount.invalidate(),
        ]);
        toast.success(t('examination:toast.savedAndFinished'));
      } catch {
        toast.warning(t('examination:toast.savedNotFinished'));
      }
    } else {
      toast.success(isEdit ? t('examination:toast.updated') : t('examination:toast.created'));
    }
    justSubmittedRef.current = true;
    onSaved();
    onOpenChange(false);
  };

  const create = trpc.examination.create.useMutation({
    onSuccess: async (created: { id: string }) => {
      if (draftSaveRef.current) {
        setDraftId(created.id);
        toast.success(t('examination:toast.draftSaved'));
        await utils.examination.openDraft.invalidate({ patientId });
        return;
      }
      await utils.examination.listByPatient.invalidate({ patientId });
      await finalizeAfterSave();
    },
    onError: handleError,
  });

  const update = trpc.examination.update.useMutation({
    onSuccess: async () => {
      if (draftSaveRef.current) {
        toast.success(t('examination:toast.draftSaved'));
        await utils.examination.openDraft.invalidate({ patientId });
        return;
      }
      await Promise.all([
        utils.examination.listByPatient.invalidate({ patientId }),
        existing && utils.examination.findById.invalidate({ id: existing.id }),
        utils.examination.openDraft.invalidate({ patientId }),
      ]);
      await finalizeAfterSave();
    },
    onError: handleError,
  });

  // Form alanlarını backend payload'una çevirir (findings + ICD birleşik).
  const buildPayload = () => {
    const examDate = new Date(examinedAt);
    if (isNaN(examDate.getTime())) {
      setFormError(t('examination:errors.invalidDate'));
      return null;
    }
    const findingsWithIcd: Record<string, unknown> = {
      ...(findings as Record<string, unknown>),
      ...(icd10.length > 0 ? { icd10 } : {}),
    };
    if (icd10.length === 0) delete findingsWithIcd.icd10;
    return {
      examinedAt: examDate.toISOString(),
      chiefComplaint: chiefComplaint.trim() || null,
      history: history.trim() || null,
      findings: findingsWithIcd,
      diagnosis: diagnosis.trim() || null,
      treatmentPlan: treatmentPlan.trim() || null,
      prescription: prescription.trim() || null,
    };
  };

  // #379 — "Taslak kaydet": draftId varsa aynı kaydı güncelle, yoksa yeni create.
  const onSaveDraft = () => {
    setFormError(null);
    const payload = buildPayload();
    if (!payload) return;
    draftSaveRef.current = true;
    if (draftId) {
      update.mutate({ id: draftId, data: { ...payload, status: 'draft' } });
    } else {
      create.mutate({ patientId, doctorId: doctorUserId, ...payload, status: 'draft' });
    }
  };

  const submitFinal = (finish: boolean) => {
    setFormError(null);
    const payload = buildPayload();
    if (!payload) return;
    draftSaveRef.current = false;
    finishRef.current = finish;

    if (isEdit && existing) {
      update.mutate({ id: existing.id, data: { ...payload, status: 'final' } });
    } else if (draftId) {
      // #379 — yüklenen/kaydedilen taslağı finalize et (yeni kayıt açma).
      update.mutate({ id: draftId, data: { ...payload, status: 'final' } });
    } else {
      create.mutate({
        patientId,
        doctorId: doctorUserId,
        ...payload,
        status: 'final',
      });
    }
  };

  // R1 (#723) — Enter / birincil buton: aktif ziyaret varsa "bitir" ile finalize.
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitFinal(canFinish);
  };

  const submitting = create.isPending || update.isPending || closeEncounter.isPending;
  const titleKey = isEdit ? 'examination:form.editTitle' : 'examination:form.createTitle';
  const submitKey = isEdit ? 'examination:form.update' : 'examination:form.submit';

  // SİS-8 — Sekme kapat/yenile uyarısı + dialog kapanışında teyit.
  useUnsavedWarning(open && dirty);
  const requestClose = (next: boolean) => {
    if (!next && dirty && !confirmIfDirty(true, t('common:forms.unsavedConfirm'))) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>{t(titleKey)}</DialogTitle>
        <DialogDescription>{t('examination:form.description')}</DialogDescription>
        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="exam-datetime">{t('examination:form.fields.examinedAt')}</Label>
            <DateTimeField id="exam-datetime" value={examinedAt} onChange={setExaminedAt} />
          </div>

          <Field
            id="exam-cc"
            label={t('examination:form.fields.chiefComplaint')}
            value={chiefComplaint}
            onChange={setChiefComplaint}
            maxLength={1000}
            rows={2}
          />
          <Field
            id="exam-history"
            label={t('examination:form.fields.history')}
            value={history}
            onChange={setHistory}
            maxLength={5000}
            rows={3}
          />

          <section className="space-y-2 rounded-md border bg-muted/30 p-3">
            <h3 className="text-sm font-medium">{t('examination:form.fields.findingsTitle')}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FINDINGS_FIELDS.map((key) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`exam-find-${key}`}>{t(`examination:findings.${key}`)}</Label>
                  <Input
                    id={`exam-find-${key}`}
                    type="text"
                    maxLength={500}
                    value={findings[key] ?? ''}
                    onChange={(e) => setFindings((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </section>

          <div className="space-y-1.5">
            <Label>{t('examination:form.fields.icd10')}</Label>
            <IcdCodePicker value={icd10} onChange={setIcd10} />
          </div>

          <Field
            id="exam-diagnosis"
            label={t('examination:form.fields.diagnosis')}
            value={diagnosis}
            onChange={setDiagnosis}
            maxLength={2000}
            rows={2}
          />
          <Field
            id="exam-plan"
            label={t('examination:form.fields.treatmentPlan')}
            value={treatmentPlan}
            onChange={setTreatmentPlan}
            maxLength={5000}
            rows={3}
          />
          <Field
            id="exam-rx"
            label={t('examination:form.fields.prescription')}
            value={prescription}
            onChange={setPrescription}
            maxLength={5000}
            rows={3}
          />

          {formError && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => requestClose(false)}>
              {t('common:actions.cancel')}
            </Button>
            {/* #379 — yarım muayene kaybını önle: taslak kaydet (kapanmaz). */}
            {!isEdit && (
              <Button type="button" variant="outline" disabled={submitting} onClick={onSaveDraft}>
                {t('examination:form.saveDraft')}
              </Button>
            )}
            {/* R1 (#723) — aktif in_exam ziyaret varsa "Sadece Kaydet" ikincil,
                birincil "Kaydet + Muayeneyi Bitir" (encounter done). Yoksa tek "Kaydet". */}
            {canFinish && (
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => submitFinal(false)}
              >
                {t('examination:form.saveOnly')}
              </Button>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting
                ? t('examination:form.submitting')
                : canFinish
                  ? t('examination:form.saveAndFinish')
                  : t(submitKey)}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  maxLength,
  rows,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
  rows: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        rows={rows}
        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}
