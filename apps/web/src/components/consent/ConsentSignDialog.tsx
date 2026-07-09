import { useMemo, useRef, useState } from 'react';
import { Eraser, Loader2 } from 'lucide-react';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { trpc } from '../../lib/trpc';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  surgeryId?: string;
  onSigned: () => void;
}

interface TemplateRow {
  id: string;
  procedureType: 'cataract' | 'retina' | 'laser' | 'intravitreal' | 'refractive' | 'general';
  language: 'tr' | 'ru' | 'tg';
  version: number;
  title: string;
  content: string;
  isActive: boolean;
}

const PROCEDURE_TYPES = [
  'cataract',
  'retina',
  'laser',
  'intravitreal',
  'refractive',
  'general',
] as const;
const LANGUAGES = ['tr', 'ru', 'tg'] as const;

export function ConsentSignDialog({ open, onOpenChange, patientId, surgeryId, onSigned }: Props) {
  const { t } = useTranslation(['consent', 'common']);
  const padRef = useRef<SignaturePadHandle | null>(null);

  const [procedureType, setProcedureType] = useState<(typeof PROCEDURE_TYPES)[number]>('cataract');
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>('tr');
  const [templateId, setTemplateId] = useState<string>('');
  const [witnessName, setWitnessName] = useState('');
  // S15-PR7 — Pediatrik veli onam alanları (hasta yaş <18 ise UI tarafından
  // zorunlu; backend service-layer guard'ı patient.birthDate'ten yaşı
  // hesaplayıp yine kontrol eder).
  const [guardianName, setGuardianName] = useState('');
  const [guardianRelationship, setGuardianRelationship] = useState<
    'mother' | 'father' | 'legal_guardian' | 'grandparent' | 'sibling' | 'other' | ''
  >('');
  const [guardianIdentityNo, setGuardianIdentityNo] = useState('');

  // Hasta yaşı: detail query ile fetch et; reşit değilse veli alanları görünür.
  const patient = trpc.patient.findById.useQuery({ id: patientId });
  const patientBirth = (patient.data as { birthDate?: string | Date } | undefined)?.birthDate;
  const patientAge = useMemo(() => {
    if (!patientBirth) return null;
    const bd = patientBirth instanceof Date ? patientBirth : new Date(patientBirth);
    if (Number.isNaN(bd.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - bd.getFullYear();
    const m = today.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age -= 1;
    return age;
  }, [patientBirth]);
  const isPediatric = patientAge !== null && patientAge < 18;

  const list = trpc.consent.listTemplates.useQuery({
    procedureType,
    language,
    includeInactive: false,
  });
  const templates = (list.data as TemplateRow[] | undefined) ?? [];
  const selectedTemplate = useMemo(
    () => templates.find((tpl) => tpl.id === templateId) ?? templates[0] ?? null,
    [templates, templateId],
  );

  const sign = trpc.consent.sign.useMutation({
    onSuccess: () => {
      toast.success(t('consent:toast.signed'));
      onSigned();
    },
    onError: (err) =>
      toast.error(err instanceof TRPCClientError ? err.message : t('consent:errors.unknown')),
  });

  const handleSubmit = () => {
    if (!selectedTemplate) {
      toast.error(t('consent:errors.noTemplate'));
      return;
    }
    if (padRef.current?.isEmpty() ?? true) {
      toast.error(t('consent:errors.signatureEmpty'));
      return;
    }
    // S15-PR7 — Pediatrik veli onam UI guard'ı.
    if (isPediatric) {
      if (!guardianName.trim()) {
        toast.error(t('consent:errors.guardianNameRequired'));
        return;
      }
      if (!guardianRelationship) {
        toast.error(t('consent:errors.guardianRelationshipRequired'));
        return;
      }
    }
    const signatureData = padRef.current!.toDataURL();
    sign.mutate({
      templateId: selectedTemplate.id,
      patientId,
      surgeryId,
      signatureData,
      witnessName: witnessName.trim() || undefined,
      signedByGuardian: isPediatric,
      guardianName: isPediatric ? guardianName.trim() : undefined,
      guardianRelationship: isPediatric
        ? (guardianRelationship as
            | 'mother'
            | 'father'
            | 'legal_guardian'
            | 'grandparent'
            | 'sibling'
            | 'other')
        : undefined,
      guardianIdentityNo:
        isPediatric && guardianIdentityNo.trim() ? guardianIdentityNo.trim() : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogTitle>{t('consent:dialog.title')}</DialogTitle>
        <DialogDescription>{t('consent:dialog.description')}</DialogDescription>

        <section className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="consent-proc">{t('consent:dialog.procedureType')}</Label>
            <select
              id="consent-proc"
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={procedureType}
              onChange={(e) => {
                setProcedureType(e.target.value as typeof procedureType);
                setTemplateId('');
              }}
            >
              {PROCEDURE_TYPES.map((p) => (
                <option key={p} value={p}>
                  {t(`consent:procedure.${p}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="consent-lang">{t('consent:dialog.language')}</Label>
            <select
              id="consent-lang"
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value as typeof language);
                setTemplateId('');
              }}
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="consent-tpl">{t('consent:dialog.template')}</Label>
            <select
              id="consent-tpl"
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={selectedTemplate?.id ?? ''}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={templates.length === 0}
            >
              {templates.length === 0 && <option value="">{t('consent:dialog.noTemplate')}</option>}
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.title} (v{tpl.version})
                </option>
              ))}
            </select>
          </div>
        </section>

        {selectedTemplate && (
          <section className="mt-4">
            <Label>{t('consent:dialog.preview')}</Label>
            <div
              className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs"
              data-testid="consent-preview"
            >
              {selectedTemplate.content}
            </div>
          </section>
        )}

        {/* S15-PR7 — Pediatrik veli onam paneli (yaş <18 ise zorunlu). */}
        {isPediatric && (
          <section className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              {t('consent:pediatric.title', { age: patientAge })}
            </div>
            <p className="text-xs text-amber-800">{t('consent:pediatric.description')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="consent-guardian-name">
                  {t('consent:pediatric.guardianName')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="consent-guardian-name"
                  value={guardianName}
                  maxLength={200}
                  onChange={(e) => setGuardianName(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="consent-guardian-rel">
                  {t('consent:pediatric.relationship')} <span className="text-destructive">*</span>
                </Label>
                <select
                  id="consent-guardian-rel"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={guardianRelationship}
                  onChange={(e) =>
                    setGuardianRelationship(e.target.value as typeof guardianRelationship)
                  }
                  required
                >
                  <option value="">{t('consent:pediatric.relationshipUnset')}</option>
                  <option value="mother">{t('consent:pediatric.rel.mother')}</option>
                  <option value="father">{t('consent:pediatric.rel.father')}</option>
                  <option value="legal_guardian">
                    {t('consent:pediatric.rel.legal_guardian')}
                  </option>
                  <option value="grandparent">{t('consent:pediatric.rel.grandparent')}</option>
                  <option value="sibling">{t('consent:pediatric.rel.sibling')}</option>
                  <option value="other">{t('consent:pediatric.rel.other')}</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="consent-guardian-id">{t('consent:pediatric.identityNo')}</Label>
                <Input
                  id="consent-guardian-id"
                  value={guardianIdentityNo}
                  maxLength={50}
                  onChange={(e) => setGuardianIdentityNo(e.target.value)}
                  placeholder={t('consent:pediatric.identityPlaceholder')}
                />
              </div>
            </div>
          </section>
        )}

        <section className="mt-4">
          <Label htmlFor="consent-witness">{t('consent:dialog.witnessName')}</Label>
          <Input
            id="consent-witness"
            value={witnessName}
            maxLength={200}
            onChange={(e) => setWitnessName(e.target.value)}
            placeholder={t('consent:dialog.witnessPlaceholder')}
          />
        </section>

        <section className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t('consent:dialog.signature')}</Label>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => padRef.current?.clear()}
            >
              <Eraser className="mr-1 h-3 w-3" />
              {t('consent:dialog.clearSignature')}
            </Button>
          </div>
          <SignaturePad ref={padRef} width={600} height={180} />
          <p className="text-xs text-muted-foreground">{t('consent:dialog.signatureHint')}</p>
        </section>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={sign.isPending || !selectedTemplate}>
            {sign.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {t('consent:dialog.submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
