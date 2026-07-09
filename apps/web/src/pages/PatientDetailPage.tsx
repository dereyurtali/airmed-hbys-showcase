import { localeToIntl } from '../lib/i18n-format';
import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, CalendarPlus, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PatientInvoicesSection } from '../components/billing/PatientInvoicesSection';
import { ExaminationTimeline } from '../components/examination/ExaminationTimeline';
import { AppointmentHistorySection } from '../components/schedule/AppointmentHistorySection';
import { PostExamDecisionPanel } from '../components/examination/PostExamDecisionPanel';
import { PatientMessageThread } from '../components/patient/PatientMessageThread';
import { LabTestHistory } from '../components/lab/LabTestHistory';
import { MeasurementHistory } from '../components/measurement/MeasurementHistory';
// #1056 — recharts (~370KB) hasta detayının kritik yolunda değil; trend
// bölümü kendi chunk'ında gelir (vendor-charts ReportsPage ile paylaşılır).
const MeasurementTrendChart = lazy(() =>
  import('../components/measurement/MeasurementTrendChart').then((m) => ({
    default: m.MeasurementTrendChart,
  })),
);
import { ClinicalSummaryCard } from '../components/patient/ClinicalSummaryCard';
import { ClinicalListsSection } from '../components/patient/ClinicalListsSection';
import { PatientTagBadges } from '../components/patient/PatientTagBadges';
import { EmergencyBypassDialog } from '../components/encounter/EmergencyBypassDialog';
import { StickyClinicalAlertBanner } from '../components/clinical/StickyClinicalAlertBanner';
import { ConsentsSection } from '../components/consent/ConsentsSection';
import { PrescriptionsSection } from '../components/pharmacy/PrescriptionsSection';
import { ProcedureTimeline } from '../components/procedure/ProcedureTimeline';
import { SurgeryTimeline } from '../components/surgery/SurgeryTimeline';
import { PageHeader } from '../components/layout/PageHeader';
import { PhotoGallery } from '../components/photo/PhotoGallery';
import { Button } from '../components/ui/button';
import { usePermissions } from '../hooks/usePermission';
import { useLocale } from '../providers/LocaleProvider';
import { trpc } from '../lib/trpc';

export function PatientDetailPage() {
  const { t } = useTranslation(['patient', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bypassDialog, setBypassDialog] = useState<{
    encounterId: string;
    mode: 'activate' | 'close';
  } | null>(null);
  // S7 — KVKK hard-delete (karar tutanağı §6.1). Çift onay: önce "Kalıcı Sil"
  // butonu modal açar, sonra kullanıcı "DELETE" yazıp sebep girer.
  const [hardConfirm, setHardConfirm] = useState<{ typed: string; reason: string } | null>(null);

  // S6 — Rol-bazlı içerik görünürlüğü (karar tutanağı §5.1). Tek hook'ta
  // çoklu permission çağrısı (React hook kuralı: koşullu çağrı yasak).
  const can = usePermissions([
    'view:patient.clinical_summary_card',
    'view:patient.exam_timeline',
    'view:patient.measurement_history',
    'view:patient.lab_history',
    'view:patient.surgery_timeline',
    'view:patient.procedure_timeline',
    'view:patient.prescriptions',
    'view:patient.consents',
    'view:patient.photo_gallery',
    'view:patient.invoices',
    'view:patient.openBalance',
    'action:patient.update',
    'action:appointment.create',
    'action:patient.softDelete',
    'action:patient.hardDelete',
    'action:encounter.emergencyBypass',
  ]);

  // S15-PR5 — Hasta için aktif encounter ve bypass durumu (yönetici görür).
  const activeEncounter = trpc.encounter.activeForPatient.useQuery(
    { patientId: id ?? '' },
    { enabled: !!id && can['action:encounter.emergencyBypass'] === true },
  );

  const detail = trpc.patient.findById.useQuery({ id: id ?? '' }, { enabled: !!id, retry: false });

  const softDelete = trpc.patient.softDelete.useMutation({
    onSuccess: async () => {
      await utils.patient.list.invalidate();
      navigate('/patients', { replace: true });
    },
  });

  const hardDelete = trpc.patient.hardDelete.useMutation({
    onSuccess: async () => {
      await utils.patient.list.invalidate();
      navigate('/patients', { replace: true });
    },
  });

  const formatDate = (value: string | Date | null | undefined): string => {
    if (!value) return '—';
    const d = typeof value === 'string' ? new Date(value) : value;
    return d.toLocaleDateString(dateLocale);
  };

  const genderLabel = (gender: string): string => {
    if (gender === 'male' || gender === 'female' || gender === 'other') {
      return t(`patient:gender.${gender}`);
    }
    return gender;
  };

  if (detail.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="max-w-sm space-y-3 text-center">
          <p className="text-sm text-destructive">
            {detail.error
              ? t('patient:detail.notFoundWithMessage', { message: detail.error.message })
              : t('patient:detail.notFound')}
          </p>
          <Button asChild variant="outline">
            <Link to="/patients">{t('common:actions.backToList')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const p = detail.data;

  return (
    <div className="space-y-6">
      {/* Ray 1 + Ray 2 (airmed-design Bölüm 0.5) — sticky hasta kimliği + alerji/
          antikoagülan banner (dismiss yok). Eski satır-içi uyarı bölümünün yerine. */}
      <StickyClinicalAlertBanner
        patient={{
          firstName: p.firstName,
          lastName: p.lastName,
          mrn: p.mrn,
          birthDate: p.birthDate as string | Date | null,
          gender: p.gender,
          allergies: (p as { allergies?: string[] | null }).allergies ?? [],
          anticoagulantMedications:
            (p as { anticoagulantMedications?: string[] | null }).anticoagulantMedications ?? [],
        }}
        className="-mx-4 -mt-4 sm:-mx-6"
      />
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {p.firstName} {p.lastName}
            <PatientTagBadges tags={(p as { tags?: string[] }).tags ?? []} />
          </span>
        }
        description={p.mrn}
        actions={
          <>
            {can['action:appointment.create'] && (
              <Button asChild variant="outline" data-testid="patient-new-appointment">
                <Link to={`/schedule?patientId=${p.id}`}>
                  <CalendarPlus className="mr-2 h-4 w-4" />
                  {t('patient:detail.newAppointment')}
                </Link>
              </Button>
            )}
            {can['action:patient.update'] && (
              <Button asChild>
                <Link to={`/patients/${p.id}/edit`}>{t('patient:detail.edit')}</Link>
              </Button>
            )}
            {can['action:patient.softDelete'] && (
              <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                {t('patient:detail.delete')}
              </Button>
            )}
            {can['action:patient.hardDelete'] && (
              <Button
                variant="outline"
                className="border-destructive text-destructive hover:bg-destructive/10"
                onClick={() => setHardConfirm({ typed: '', reason: '' })}
                data-testid="patient-hard-delete-button"
              >
                {t('patient:detail.hardDelete', { defaultValue: 'Kalıcı Sil (KVKK)' })}
              </Button>
            )}
            {/* S15-PR5 — Acil bypass (Break Glass): yönetici görür, aktif
                encounter varsa aktive/close yönlendir. */}
            {can['action:encounter.emergencyBypass'] && activeEncounter.data && (
              <Button
                variant="outline"
                className="border-warning-border text-warning-foreground hover:bg-warning-bg"
                onClick={() =>
                  setBypassDialog({
                    encounterId: activeEncounter.data!.id,
                    mode: activeEncounter.data!.stage === 'emergency_bypass' ? 'close' : 'activate',
                  })
                }
              >
                <AlertCircle className="mr-2 h-4 w-4" />
                {activeEncounter.data.stage === 'emergency_bypass'
                  ? t('encounter:bypass.closeSubmit')
                  : t('encounter:bypass.activateSubmit')}
              </Button>
            )}
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 rounded-lg border bg-background p-6">
        <Field label={t('patient:detail.fields.birthDate')} value={formatDate(p.birthDate)} />
        <Field label={t('patient:detail.fields.gender')} value={genderLabel(p.gender)} />
        <Field label={t('patient:detail.fields.phone')} value={p.phone ?? '—'} />
        <Field label={t('patient:detail.fields.email')} value={p.email ?? '—'} />
        <Field label={t('patient:detail.fields.identityNo')} value={p.identityNo ?? '—'} />
        <Field label={t('patient:detail.fields.passportNo')} value={p.passportNo ?? '—'} />
        <Field
          label={t('patient:detail.fields.bloodType')}
          value={
            (p as { bloodType?: string | null }).bloodType
              ? t(`patient:bloodType.${(p as { bloodType: string }).bloodType}`)
              : '—'
          }
        />
        <Field
          label={t('patient:detail.fields.emergencyName')}
          value={p.emergencyContactName ?? '—'}
        />
        <Field
          label={t('patient:detail.fields.emergencyPhone')}
          value={p.emergencyContactPhone ?? '—'}
        />
        <Field
          label={t('patient:detail.fields.address')}
          value={p.address ?? '—'}
          className="sm:col-span-2"
        />
        <Field
          label={t('patient:detail.fields.notes')}
          value={p.notes ?? '—'}
          className="sm:col-span-2"
        />
        <Field
          label={t('patient:detail.fields.leadSource')}
          value={p.leadSource ? t(`patient:leadSource.${p.leadSource}`) : '—'}
        />
        <Field label={t('patient:detail.fields.leadSourceNote')} value={p.leadSourceNote ?? '—'} />
        <Field label={t('patient:detail.fields.createdAt')} value={formatDate(p.createdAt)} />
        <Field label={t('patient:detail.fields.updatedAt')} value={formatDate(p.updatedAt)} />
      </section>

      {can['view:patient.clinical_summary_card'] && <ClinicalSummaryCard patientId={p.id} />}

      {/* R1 (#723) — Kalıcı problem + ilaç listesi (EHR problem list). Klinik
          bağlam üstte: doktor hastayı açar açmaz sürekli problem/ilaçları görür. */}
      {can['view:patient.exam_timeline'] && <ClinicalListsSection patientId={p.id} />}

      {/* S15 Feature 6 — muayene-sonrası karar paneli (aktif ziyaret varsa) */}
      <PostExamDecisionPanel patientId={p.id} />

      {/* S15-PR19 — Bağlamsal mesajlaşma (klinik personeli arası, hasta-bağlı) */}
      <PatientMessageThread patientId={p.id} />

      {/* #373 — Randevu geçmişi (en son geliş + no_show sayısı). Temel ziyaret
          bilgisi; ayrı view izni yok, hasta detayını görebilen herkes görür. */}
      <AppointmentHistorySection patientId={p.id} />

      {can['view:patient.exam_timeline'] && <ExaminationTimeline patientId={p.id} />}

      {can['view:patient.measurement_history'] && (
        <>
          <Suspense fallback={null}>
            <MeasurementTrendChart patientId={p.id} />
          </Suspense>
          <MeasurementHistory patientId={p.id} />
        </>
      )}

      {can['view:patient.lab_history'] && <LabTestHistory patientId={p.id} />}

      <div id="section-surgeries">
        {can['view:patient.surgery_timeline'] && <SurgeryTimeline patientId={p.id} />}
      </div>

      {can['view:patient.procedure_timeline'] && <ProcedureTimeline patientId={p.id} />}

      {can['view:patient.photo_gallery'] && <PhotoGallery patientId={p.id} />}

      <div id="section-prescriptions">
        {can['view:patient.prescriptions'] && <PrescriptionsSection patientId={p.id} />}
      </div>

      {can['view:patient.consents'] && <ConsentsSection patientId={p.id} />}

      {/* S11f — Billing (faturalar) hasta detayında */}
      {can['view:patient.invoices'] && <PatientInvoicesSection patientId={p.id} />}

      {/* S15-PR5 — Break Glass dialog (yönetici + aktif encounter görüldükte) */}
      {bypassDialog && (
        <EmergencyBypassDialog
          open={!!bypassDialog}
          onOpenChange={(open) => !open && setBypassDialog(null)}
          encounterId={bypassDialog.encounterId}
          mode={bypassDialog.mode}
          onCompleted={() => void activeEncounter.refetch()}
        />
      )}

      {confirmDelete && (
        <div className="space-y-3 rounded-lg border border-critical-border bg-critical-bg px-4 py-3 text-sm text-critical-foreground">
          <p className="font-medium">{t('patient:detail.confirm.title')}</p>
          <p className="text-xs">{t('patient:detail.confirm.description')}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>
              {t('patient:detail.confirm.cancel')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={softDelete.isPending}
              onClick={() => softDelete.mutate({ id: p.id })}
            >
              {softDelete.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('patient:detail.confirm.confirm')}
            </Button>
          </div>
        </div>
      )}

      {/* S7 — KVKK hard-delete çift onay (karar tutanağı §6.1) */}
      {hardConfirm && (
        <div
          className="space-y-3 rounded-lg border-2 border-critical-border bg-critical-bg px-4 py-3 text-sm"
          data-testid="patient-hard-delete-modal"
        >
          <p className="font-semibold text-destructive">
            {t('patient:detail.hardConfirm.title', { defaultValue: 'KALICI SİLME (KVKK)' })}
          </p>
          <p className="text-xs text-destructive">
            {t('patient:detail.hardConfirm.warning', {
              defaultValue:
                'Bu işlem GERİ ALINAMAZ. Hasta verisi + tüm randevu/muayene/cerrahi/foto kayıtları KALICI silinir. Onaylamak için "DELETE" yazın ve sebep girin (KVKK gereği audit log).',
            })}
          </p>
          <input
            type="text"
            value={hardConfirm.typed}
            onChange={(e) => setHardConfirm({ ...hardConfirm, typed: e.target.value })}
            placeholder='Tip: "DELETE"'
            className="focus-ring w-full rounded-lg border border-field bg-background px-3 py-1.5 font-mono text-sm hover:border-field-hover"
            data-testid="patient-hard-delete-typed"
          />
          <textarea
            value={hardConfirm.reason}
            onChange={(e) => setHardConfirm({ ...hardConfirm, reason: e.target.value })}
            placeholder={t('patient:detail.hardConfirm.reasonPlaceholder', {
              defaultValue: 'Silme sebebi (min 10 karakter — KVKK talep no, hasta isteği, vb.)',
            })}
            className="focus-ring w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
            rows={3}
            data-testid="patient-hard-delete-reason"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setHardConfirm(null)}>
              {t('common:actions.cancel', { defaultValue: 'İptal' })}
            </Button>
            <Button
              size="sm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={
                hardDelete.isPending ||
                hardConfirm.typed !== 'DELETE' ||
                hardConfirm.reason.length < 10
              }
              onClick={() =>
                hardDelete.mutate({ id: p.id, confirm: 'DELETE', reason: hardConfirm.reason })
              }
              data-testid="patient-hard-delete-submit"
            >
              {hardDelete.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('patient:detail.hardConfirm.confirm', { defaultValue: 'KALICI SİL' })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
