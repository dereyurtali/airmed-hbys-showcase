import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { localeToIntl, getDateTimeFormat } from '../lib/i18n-format';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Droplet,
  FileText,
  FlaskConical,
  Loader2,
  Scissors,
  Search,
  Siren,
  Star,
  Stethoscope,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MeasurementOrderSheet } from '../components/measurement/MeasurementOrderSheet';
import { FindingsView } from '../components/examination/FindingsView';
import { type ExaminationFindings } from '../lib/examination.constants';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState } from '../components/ui/empty-state';
import { cn } from '../lib/utils';
import { type EncounterStage } from '../lib/encounter.constants';
import { ROLES } from '@airmed/contracts';
import { usePermissions } from '../hooks/usePermission';
import { trpc } from '../lib/trpc';
import { mapTrpcError } from '../lib/trpc-error';
import { useAuth } from '../providers/AuthProvider';
import { useLocale } from '../providers/LocaleProvider';

// Sekme → istasyon eşlemesi. "Sırada" aktif işlenen hastalar; "Ölçüm hazır"
// sonuç dönenler (acil dikkat); "Ödenmemiş" kasaya yönlendirilmiş bekleyenler.
// #365 — "önce öde" gereği doktor GİRİŞ ödemesi bekleyeni (awaiting_exam_payment)
// hiçbir zaman görmez: backend DOCTOR_WORKLIST_STAGES onu döndürmüyordu, FE'de
// ölü kalmıştı. Stage kaldırıldı → FE TAB_STAGES ⊆ BE DOCTOR_WORKLIST_STAGES.
// awaiting_measurement_payment KALIR (doktor ölçüm istedi, hasta kasada; BE döndürür).
const TAB_STAGES = {
  sirada: ['waiting_doctor', 'in_exam', 'in_measurement', 'awaiting_surgery_sales'],
  ready: ['measurement_ready'],
  unpaid: ['awaiting_measurement_payment'],
} as const satisfies Record<string, readonly EncounterStage[]>;

type TabKey = keyof typeof TAB_STAGES;
const TAB_ORDER: TabKey[] = ['sirada', 'ready', 'unpaid'];

// R1 (#723) — aksiyon-odaklı sıralama: "Sırada" sekmesinde doktorun ŞİMDİ
// aksiyon alabileceği istasyonlar üstte. waiting_doctor (Muayeneye Al) +
// in_exam (Tamamla) doktor-aksiyonlu; in_measurement (hemşirede) +
// awaiting_surgery_sales (satışta) başkasını bekliyor → alta.
const DOCTOR_ACTIONABLE_STAGES: readonly EncounterStage[] = ['waiting_doctor', 'in_exam'];
const SIRADA_STAGE_PRIORITY: Record<string, number> = {
  waiting_doctor: 0,
  in_exam: 1,
  in_measurement: 2,
  awaiting_surgery_sales: 3,
};

// #1152 — VIP tier: hasta 'vip' etiketi taşıyorsa kuyrukta öne çıkar (acil'in
// hemen altında). Backend sortVipFirst ile aynı kural (tek doğru kaynak: patient.tags).
function isVipRow(row: WorklistRow): boolean {
  return (row.patient.tags ?? []).includes('vip');
}

// #1152 — Karar B: kuyruk sırası birincil olarak RANDEVU SAATİNE (appointment.startsAt)
// göre; randevusuz walk-in için varış (openedAt) kullanılır. Böylece erken gelip
// kuyruk atlama engellenir, randevusuz hasta geldiği ana göre sıralanır.
function queueTimeKey(row: WorklistRow): number {
  return new Date(row.appointment?.startsAt ?? row.openedAt).getTime();
}

interface WorklistRow {
  id: string;
  stage: EncounterStage;
  stageUpdatedAt: string;
  openedAt: string;
  // #1152 — Acil triyaj bayrağı (backend Encounter.isUrgent). Doktor kuyruğunda
  // acil hasta stage gruplamasının da üstünde en tepeye çıkar (Karar A).
  isUrgent?: boolean;
  urgentReason?: string | null;
  patient: {
    id: string;
    mrn: string;
    firstName: string;
    lastName: string;
    tags?: string[] | null;
  };
  appointment: { id: string; startsAt: string; type: string; notes: string | null } | null;
}

interface PatientDetail {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: 'male' | 'female' | 'other';
  identityNo: string | null;
  passportNo: string | null;
  phone: string | null;
  phoneLast4: string | null;
  leadSourceNote: string | null;
  // #388 — güvenlik sinyali (findById döndürür): worklist başlığında rozet.
  allergies?: string[];
  anticoagulantMedications?: string[];
}

interface ExaminationRow {
  id: string;
  examinedAt: string;
  chiefComplaint: string | null;
  history: string | null;
  diagnosis: string | null;
  treatmentPlan: string | null;
  prescription: string | null;
  // #388 — klinik bulgular (VA OD/OS, ön segment, fundus); FindingsView okur.
  findings?: ExaminationFindings | null;
}

interface SurgeryRow {
  id: string;
  type: string;
  status: string;
  scheduledAt: string;
  performedAt: string | null;
  eyeSide: 'od' | 'os' | 'ou' | null;
}

// İki ISO tarih aynı takvim gününde mi (aynı-vizit eşlemesi proxy'si).
function isSameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

interface MeasurementRow {
  id: string;
  type: string;
  eyeSide: 'od' | 'os' | 'ou';
  values: Record<string, unknown>;
  measuredAt: string;
}

function ageFromBirth(birthDate: string): number {
  const b = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}

function maskIdentity(p: PatientDetail): string | null {
  const id = p.identityNo ?? p.passportNo;
  if (!id) return null;
  if (id.length <= 5) return id;
  return `${id.slice(0, 3)}••••••${id.slice(-2)}`;
}

function maskPhone(p: PatientDetail): string | null {
  if (p.phone && p.phone.length >= 6) {
    return `${p.phone.slice(0, 4)}•• ••${p.phone.slice(-2)}`;
  }
  if (p.phoneLast4) return `•••• ${p.phoneLast4}`;
  return p.phone ?? null;
}

function initials(first: string, last: string): string {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

// #390 — null-korumalı çok-alanlı formatlayıcı: yalnız dolu alanları gösterir.
// Eski refraksiyon fmt'i sphere doluyken cylinder/axis boşsa "−2.25 / undefined ×
// undefined°" üretiyordu; bu guard her alanı ayrı kontrol eder, eksikleri atlar.
function fmtFields(
  v: Record<string, unknown> | undefined,
  fields: { key: string; label?: string; unit?: string }[],
): string {
  if (!v) return '—';
  const parts = fields
    .map((f) => {
      const raw = v[f.key];
      if (raw == null || String(raw).trim() === '') return null;
      const prefix = f.label ? `${f.label} ` : '';
      return `${prefix}${raw}${f.unit ?? ''}`;
    })
    .filter((p): p is string => p !== null);
  return parts.length ? parts.join(' · ') : '—';
}

// Ölçüm satırları: type → SAĞ/SOL değer formatlayıcı. values JSON şekli ölçüm-giriş
// (MeasurementQueuePage ENTRY_CONFIG) ile birebir. 10 tipin tamamı listelenir;
// değer yoksa fmt '—' döner (#390: eksik 6 tip artık doktorda görünür).
const MEAS_ROWS: {
  type: string;
  labelKey: string;
  fmt: (v: Record<string, unknown> | undefined) => string;
  abnormal?: (v: Record<string, unknown> | undefined) => boolean;
}[] = [
  {
    type: 'visual_acuity',
    labelKey: 'meas.va',
    fmt: (v) => (v?.decimal != null ? String(v.decimal) : '—'),
    abnormal: (v) => v?.decimal != null && Number(v.decimal) < 0.6,
  },
  {
    type: 'intraocular_pressure',
    labelKey: 'meas.iop',
    fmt: (v) => (v?.mmHg != null ? `${v.mmHg} mmHg` : '—'),
    abnormal: (v) => v?.mmHg != null && Number(v.mmHg) > 21,
  },
  {
    type: 'refraction',
    labelKey: 'meas.refraction',
    fmt: (v) =>
      fmtFields(v, [
        { key: 'sphere', label: 'Sph' },
        { key: 'cylinder', label: 'Cyl' },
        { key: 'axis', label: 'Axis', unit: '°' },
      ]),
  },
  {
    type: 'keratometry',
    labelKey: 'meas.keratometry',
    fmt: (v) =>
      fmtFields(v, [
        { key: 'k1', label: 'K1', unit: 'D' },
        { key: 'k2', label: 'K2', unit: 'D' },
        { key: 'axis', label: 'Axis', unit: '°' },
      ]),
  },
  {
    type: 'biometry',
    labelKey: 'meas.biometry',
    fmt: (v) => (v?.axialLength != null ? `${v.axialLength} mm` : '—'),
  },
  {
    type: 'topography',
    labelKey: 'meas.topography',
    fmt: (v) => fmtFields(v, [{ key: 'value' }]),
  },
  {
    type: 'pachymetry',
    labelKey: 'meas.pachymetry',
    fmt: (v) => fmtFields(v, [{ key: 'value', unit: ' µm' }]),
  },
  {
    type: 'perimetry',
    labelKey: 'meas.perimetry',
    fmt: (v) => fmtFields(v, [{ key: 'value' }]),
  },
  {
    type: 'fundus_photo',
    labelKey: 'meas.fundusPhoto',
    fmt: (v) => fmtFields(v, [{ key: 'value' }]),
  },
  {
    type: 'oct',
    labelKey: 'meas.oct',
    fmt: (v) => fmtFields(v, [{ key: 'value' }]),
  },
];

export function WorklistPage() {
  const { t } = useTranslation('worklist');
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';
  const navigate = useNavigate();
  const { user } = useAuth();

  const isAdmin = !!user?.roles.some((r) => r === ROLES.YONETICI || r === ROLES.YONETICI_ASISTANI);
  const [doctorId, setDoctorId] = useState<string>('');
  const [tab, setTab] = useState<TabKey>('sirada');
  // R1 (#723) — "sadece aksiyon alınabilecekler" default filtre (yalnız Sırada
  // sekmesinde): doktor-aksiyonlu istasyonlar (waiting_doctor + in_exam).
  const [onlyActionable, setOnlyActionable] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);

  const doctorsQuery = trpc.doctor.list.useQuery(
    { isActive: true, page: 1, pageSize: 200 },
    { enabled: isAdmin },
  );
  const myProfile = trpc.doctor.myProfile.useQuery(undefined, { staleTime: 300_000 });

  const worklist = trpc.encounter.myWorklist.useQuery(
    { doctorId: isAdmin && doctorId ? doctorId : undefined },
    { refetchInterval: 30_000 },
  );

  const rows = (worklist.data ?? []) as unknown as WorklistRow[];

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { sirada: 0, ready: 0, unpaid: 0 };
    for (const r of rows) {
      for (const k of TAB_ORDER) {
        if ((TAB_STAGES[k] as readonly string[]).includes(r.stage)) c[k] += 1;
      }
    }
    return c;
  }, [rows]);

  const tabRows = useMemo(() => {
    const stages = TAB_STAGES[tab] as readonly string[];
    const q = search.trim().toLocaleLowerCase(dateLocale);
    const filtered = rows
      .filter((r) => stages.includes(r.stage))
      // R1 (#723) — Sırada sekmesinde "sadece aksiyon" açıkken doktor-aksiyonlu
      // olmayan (hemşirede/satışta bekleyen) satırları gizle. #1152 — acil hasta
      // istisna: hangi istasyonda olursa olsun "sadece aksiyon" açıkken bile görünür.
      .filter((r) =>
        tab === 'sirada' && onlyActionable
          ? DOCTOR_ACTIONABLE_STAGES.includes(r.stage) || !!r.isUrgent
          : true,
      )
      .filter((r) =>
        q
          ? `${r.patient.firstName} ${r.patient.lastName}`.toLocaleLowerCase(dateLocale).includes(q)
          : true,
      );
    // #1152 — Sırada sekmesi öncelik zinciri (Karar A + B):
    //   1. Acil (isUrgent) — stage gruplamasının da üstünde, en tepede
    //   2. VIP etiketi
    //   3. Aksiyon-odaklı stage önceliği (R1 #723: waiting_doctor → in_exam → …)
    //   4. Randevu saati (startsAt), randevusuzda varış (openedAt) — Karar B
    //   5. Varış (openedAt) — kesin tie-breaker
    if (tab === 'sirada') {
      return [...filtered].sort((a, b) => {
        const au = a.isUrgent ? 1 : 0;
        const bu = b.isUrgent ? 1 : 0;
        if (au !== bu) return bu - au;
        const av = isVipRow(a) ? 1 : 0;
        const bv = isVipRow(b) ? 1 : 0;
        if (av !== bv) return bv - av;
        const pa = SIRADA_STAGE_PRIORITY[a.stage] ?? 99;
        const pb = SIRADA_STAGE_PRIORITY[b.stage] ?? 99;
        if (pa !== pb) return pa - pb;
        const ta = queueTimeKey(a);
        const tb = queueTimeKey(b);
        if (ta !== tb) return ta - tb;
        return new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime();
      });
    }
    return filtered;
  }, [rows, tab, onlyActionable, search, dateLocale]);

  // Seçili satır yoksa ya da sekme değişince ilk satırı otomatik seç.
  useEffect(() => {
    if (tabRows.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !tabRows.some((r) => r.id === selectedId)) {
      setSelectedId(tabRows[0].id);
    }
  }, [tabRows, selectedId]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const selectedPatientId = selected?.patient.id ?? '';

  const patientQuery = trpc.patient.findById.useQuery(
    { id: selectedPatientId },
    { enabled: !!selectedPatientId },
  );
  const examQuery = trpc.examination.listByPatient.useQuery(
    { patientId: selectedPatientId },
    { enabled: !!selectedPatientId },
  );
  const measQuery = trpc.measurement.listByPatient.useQuery(
    { patientId: selectedPatientId },
    { enabled: !!selectedPatientId },
  );
  const surgeryQuery = trpc.surgery.listByPatient.useQuery(
    { patientId: selectedPatientId },
    { enabled: !!selectedPatientId },
  );

  const utils = trpc.useUtils();
  // #387 — eşzamanlı muayene sayacı (3-hasta hard cap rozeti + "Muayeneye Al" gate).
  const examCap = trpc.encounter.myActiveExamCount.useQuery();
  // Optimistic onMutate'lerin yazacağı kesin cache anahtarı (useQuery ile birebir).
  const worklistKey = { doctorId: isAdmin && doctorId ? doctorId : undefined };
  // #407 — "Tamamla" (encounter.close): kapanan ziyaret worklist'ten çıkar →
  // satırı optimistik kaldır (anında tepki), hata olursa geri al.
  const completeMutation = trpc.encounter.close.useMutation({
    onMutate: async (vars) => {
      await utils.encounter.myWorklist.cancel();
      const prev = utils.encounter.myWorklist.getData(worklistKey);
      utils.encounter.myWorklist.setData(
        worklistKey,
        (old) =>
          (old as unknown as WorklistRow[] | undefined)?.filter((r) => r.id !== vars.id) as never,
      );
      return { prev };
    },
    onSuccess: () => {
      toast.success(t('toast.completed'));
      setSelectedId(null);
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) utils.encounter.myWorklist.setData(worklistKey, ctx.prev);
      toast.error(mapTrpcError(err, t));
    },
    onSettled: () => {
      void utils.encounter.myWorklist.invalidate();
      void utils.encounter.myActiveExamCount.invalidate();
    },
  });
  // #387 — "Muayeneye Al": worklist'ten doğrudan waiting_doctor → in_exam.
  // 3-cap backend'de zorlu (advance to=in_exam >=3 → 400); UI'da da rozetle gösterilir.
  const startExamMutation = trpc.encounter.advance.useMutation({
    onSuccess: async () => {
      toast.success(t('toast.examStarted'));
      await Promise.all([
        utils.encounter.myWorklist.invalidate(),
        utils.encounter.myActiveExamCount.invalidate(),
      ]);
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });
  // #379 — "Geri çağır": ölçümü dönen hastayı measurement_ready → in_exam ile
  // doktor muayenesine geri al (legal transition encounter.constants.ts'te).
  const recallMutation = trpc.encounter.advance.useMutation({
    onSuccess: async () => {
      toast.success(t('toast.recalled'));
      await Promise.all([
        utils.encounter.myWorklist.invalidate(),
        utils.encounter.myActiveExamCount.invalidate(),
      ]);
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });

  // #1067 — cache'li formatter: render başına Intl constructor kurulmaz.
  const timeFmt = getDateTimeFormat(dateLocale, { hour: '2-digit', minute: '2-digit' });
  const dateFmtShort = getDateTimeFormat(dateLocale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
  const fmtDate = (iso: string) => dateFmtShort.format(new Date(iso));

  const today = new Date().toLocaleDateString(dateLocale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  });
  const doctorName =
    isAdmin && doctorId
      ? doctorsQuery.data?.items.find((d) => d.id === doctorId)?.name
      : myProfile.data?.name;

  return (
    <div className="flex h-full flex-col">
      {/* Üst başlık */}
      <header className="flex items-start justify-between gap-4 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{t('queue.title')}</h1>
            {/* #387 — eşzamanlı muayene cap rozeti (ör. 2/3). Dolunca amber. */}
            {examCap.data && (
              <span
                className={cn(
                  'inline-flex items-center rounded-badge px-2.5 py-0.5 text-xs font-semibold tabular-nums',
                  examCap.data.isAtCap
                    ? 'border border-warning-border bg-warning-bg text-warning-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
                title={t('queue.examCapHint', { cap: examCap.data.cap })}
              >
                {t('queue.examCap', { count: examCap.data.count, cap: examCap.data.cap })}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {today}
            {doctorName ? ` · ${doctorName}` : ''}
          </p>
        </div>
        <div className="relative w-64 max-w-[40vw]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('queue.search')}
            aria-label={t('queue.search')}
            className="focus-ring h-10 w-full rounded-lg border border-field bg-background pl-9 pr-3 text-sm hover:border-field-hover"
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        {/* SOL: kuyruk */}
        <aside className="flex min-h-0 flex-col rounded-xl border bg-background">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <span className="font-semibold">{t('queue.waitingPatients')}</span>
            {counts.ready > 0 && (
              <Badge variant="success" dot>
                {t('queue.readyCount', { count: counts.ready })}
              </Badge>
            )}
          </div>

          {isAdmin && (
            <div className="border-b px-3 py-2">
              <select
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                className="focus-ring h-10 w-full rounded-lg border border-field bg-background px-3 text-sm hover:border-field-hover"
              >
                <option value="">{t('filter.allDoctors')}</option>
                {(doctorsQuery.data?.items ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sekmeler */}
          <div className="flex gap-1 p-2">
            {TAB_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn(
                  'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                  tab === k ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {t(`queue.tabs.${k}`)}
                {counts[k] > 0 && <span className="ml-1 tabular-nums opacity-70">{counts[k]}</span>}
              </button>
            ))}
          </div>

          {/* R1 (#723) — Sırada'da "sadece aksiyon alınabilecekler" default filtre. */}
          {tab === 'sirada' && (
            <label className="flex cursor-pointer items-center gap-2 px-3 pb-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyActionable}
                onChange={(e) => setOnlyActionable(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-field accent-primary"
              />
              {t('queue.onlyActionable')}
            </label>
          )}

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
            {worklist.isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}

            {worklist.error && (
              <div className="m-2 rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm text-critical-foreground">
                {t('page.loadFailed', { message: worklist.error.message })}
              </div>
            )}

            {worklist.data && tabRows.length === 0 && <EmptyState title={t('queue.empty')} />}

            {tabRows.map((row, idx) => (
              <QueueCard
                key={row.id}
                row={row}
                index={idx + 1}
                selected={row.id === selectedId}
                onSelect={() => setSelectedId(row.id)}
                fmtTime={fmtTime}
              />
            ))}
          </div>
        </aside>

        {/* SAĞ: hasta detayı */}
        <section className="min-h-0 overflow-y-auto">
          {!selected ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              <div className="flex flex-col items-center gap-2 py-16">
                <ClipboardList className="h-8 w-8 text-muted-foreground/50" aria-hidden />
                {t('detail.selectPrompt')}
              </div>
            </div>
          ) : (
            <DetailPanel
              row={selected}
              patient={patientQuery.data as PatientDetail | undefined}
              patientLoading={patientQuery.isLoading}
              exams={(examQuery.data ?? []) as unknown as ExaminationRow[]}
              measurements={(measQuery.data ?? []) as unknown as MeasurementRow[]}
              surgeries={(surgeryQuery.data ?? []) as unknown as SurgeryRow[]}
              fmtTime={fmtTime}
              fmtDate={fmtDate}
              onNewMeasurement={() => setOrderOpen(true)}
              onPrescription={() => navigate(`/patients/${selected.patient.id}`)}
              onSuggestSurgery={() => navigate(`/patients/${selected.patient.id}`)}
              onComplete={() => completeMutation.mutate({ id: selected.id })}
              completing={completeMutation.isPending}
              onStartExam={() => startExamMutation.mutate({ id: selected.id, toStage: 'in_exam' })}
              startingExam={startExamMutation.isPending}
              onRecall={() => recallMutation.mutate({ id: selected.id, toStage: 'in_exam' })}
              recalling={recallMutation.isPending}
              atCap={examCap.data?.isAtCap ?? false}
            />
          )}
        </section>
      </div>

      <MeasurementOrderSheet
        open={orderOpen}
        onOpenChange={setOrderOpen}
        patientId={selected?.patient.id ?? ''}
        encounterId={selected?.id ?? null}
      />
    </div>
  );
}

// ---- Kuyruk kartı --------------------------------------------------------

function cardStatus(stage: EncounterStage): { key: string; cls: string } {
  switch (stage) {
    case 'measurement_ready':
      return {
        key: 'measurementReady',
        cls: 'border border-success-border bg-success-bg text-success-foreground',
      };
    case 'in_measurement':
      return {
        key: 'inMeasurement',
        cls: 'border border-warning-border bg-warning-bg text-warning-foreground',
      };
    case 'awaiting_measurement_payment':
    case 'awaiting_exam_payment':
      return {
        key: 'unpaid',
        cls: 'border border-critical-border bg-critical-bg text-critical-foreground',
      };
    case 'awaiting_surgery_sales':
      return {
        key: 'surgerySales',
        cls: 'border border-info-border bg-info-bg text-info-foreground',
      };
    default:
      return { key: 'inLine', cls: 'bg-muted text-muted-foreground' };
  }
}

function QueueCard({
  row,
  index,
  selected,
  onSelect,
  fmtTime,
}: {
  row: WorklistRow;
  index: number;
  selected: boolean;
  onSelect: () => void;
  fmtTime: (iso: string) => string;
}) {
  const { t } = useTranslation('worklist');
  const status = cardStatus(row.stage);
  const reason = row.appointment?.notes?.trim() || t('reasonFallback');
  const showDot = row.stage === 'measurement_ready';
  // #1152 — kuyruk önceliği görünürlüğü (renk tek başına değil: ikon + metin).
  const vip = isVipRow(row);
  const apptTime = row.appointment?.startsAt ? fmtTime(row.appointment.startsAt) : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid="queue-card"
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/30'
          : row.isUrgent
            ? 'border-critical-border/60 bg-critical-bg/40 hover:bg-critical-bg/60'
            : 'border-transparent hover:bg-muted',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
          selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {index}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {row.patient.firstName} {row.patient.lastName}
          </span>
          {vip && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-badge border border-warning-border bg-warning-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-foreground"
              title={t('priority.vip')}
            >
              <Star className="h-2.5 w-2.5" aria-hidden />
              {t('priority.vip')}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {apptTime && <span className="tabular-nums">{apptTime} · </span>}
          {reason}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {row.isUrgent && (
          <span className="inline-flex items-center gap-1 rounded-badge border border-critical-border bg-critical-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-critical-foreground">
            <Siren className="h-3 w-3" aria-hidden />
            {t('priority.urgent')}
          </span>
        )}
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-[11px] font-medium',
            status.cls,
          )}
        >
          {showDot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
          {t(`status.${status.key}`)}
        </span>
      </span>
    </button>
  );
}

// ---- Detay paneli --------------------------------------------------------

function DetailPanel({
  row,
  patient,
  patientLoading,
  exams,
  measurements,
  surgeries,
  fmtTime,
  fmtDate,
  onNewMeasurement,
  onPrescription,
  onSuggestSurgery,
  onComplete,
  completing,
  onStartExam,
  startingExam,
  onRecall,
  recalling,
  atCap,
}: {
  row: WorklistRow;
  patient: PatientDetail | undefined;
  patientLoading: boolean;
  exams: ExaminationRow[];
  measurements: MeasurementRow[];
  surgeries: SurgeryRow[];
  fmtTime: (iso: string) => string;
  fmtDate: (iso: string) => string;
  onNewMeasurement: () => void;
  onPrescription: () => void;
  onSuggestSurgery: () => void;
  onComplete: () => void;
  completing: boolean;
  onStartExam: () => void;
  startingExam: boolean;
  onRecall: () => void;
  recalling: boolean;
  atCap: boolean;
}) {
  const { t } = useTranslation('worklist');
  // Aksiyon butonları izinle kapılı: asiste eden hemşire bu ekranı salt-okunur
  // görür (doktor-düzeyi aksiyonlar gizli, 403 yerine hiç gösterilmez). Doktor +
  // yönetici izinlerine göre görünür.
  const can = usePermissions([
    'action:measurementOrder.create',
    'action:prescription.create',
    'action:surgery.create',
    'action:encounter.close',
    'action:encounter.advance',
  ]);
  // #387 — "Muayeneye Al" waiting_doctor'da birincil aksiyon; "Tamamla" yalnız
  // in_exam'da geçerli (başka stage'de backend 400 → buton disabled + tooltip).
  const canStartExam = can['action:encounter.advance'] && row.stage === 'waiting_doctor';
  // #379 — "Geri çağır": ölçümü dönen hastayı (measurement_ready) tekrar muayeneye al.
  const canRecall = can['action:encounter.advance'] && row.stage === 'measurement_ready';
  const completeEnabled = row.stage === 'in_exam';
  const hasAnyAction =
    canStartExam ||
    canRecall ||
    can['action:measurementOrder.create'] ||
    can['action:prescription.create'] ||
    can['action:surgery.create'] ||
    can['action:encounter.close'];
  const reason = row.appointment?.notes?.trim() || t('reasonFallback');
  const latestExam = exams[0];
  // En güncel muayene Öykü kartında; kalanlar (varsa) "Geçmiş Muayeneler" listesi.
  const pastExams = exams.slice(1);
  const [expandedExamId, setExpandedExamId] = useState<string | null>(null);

  // type → { od, os } değer pivotu (her tip/göz için en güncel).
  const byType = useMemo(() => {
    const map: Record<string, { od?: Record<string, unknown>; os?: Record<string, unknown> }> = {};
    for (const m of measurements) {
      const slot = (map[m.type] ??= {});
      if (m.eyeSide === 'od' && !slot.od) slot.od = m.values;
      else if (m.eyeSide === 'os' && !slot.os) slot.os = m.values;
      else if (m.eyeSide === 'ou') {
        slot.od ??= m.values;
        slot.os ??= m.values;
      }
    }
    return map;
  }, [measurements]);

  const measRows = MEAS_ROWS.filter((r) => byType[r.type]);
  const latestMeasAt = measurements[0]?.measuredAt;
  // #1152 — kuyruk önceliği + güvenlik rayları (airmed-design Bölüm 0.5).
  const vip = isVipRow(row);
  const hasAllergy = (patient?.allergies?.length ?? 0) > 0;
  const hasAnticoag = (patient?.anticoagulantMedications?.length ?? 0) > 0;
  const apptTime = row.appointment?.startsAt ? fmtTime(row.appointment.startsAt) : null;

  return (
    <div className="space-y-4">
      {/* #1152 / airmed-design Ray 1+2 — sticky hasta kimliği + alerji banner:
          doktor reçete/ölçüm/muayene yazarken kimin üstünde çalıştığı ve alerjisi
          scroll'da kaybolmaz. */}
      <div className="sticky top-0 z-30 space-y-2 bg-background pb-1">
        {/* Ray 2 — alerji (kırmızı, role=alert) + antikoagülan (amber) banner; dismiss yok. */}
        {(hasAllergy || hasAnticoag) && (
          <div className="space-y-1.5">
            {hasAllergy && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-critical-border bg-critical-bg px-3 py-2 text-sm text-critical-foreground"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-semibold">{t('detail.allergies')}:</span>{' '}
                  {patient!.allergies!.join(', ')}
                </span>
              </div>
            )}
            {hasAnticoag && (
              <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-foreground">
                <Droplet className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-semibold">{t('detail.anticoagulants')}:</span>{' '}
                  {patient!.anticoagulantMedications!.join(', ')}
                </span>
              </div>
            )}
          </div>
        )}
        {/* Ray 1 — hasta kimlik kartı */}
        <div className="rounded-xl border bg-background p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {initials(row.patient.firstName, row.patient.lastName)}
              </span>
              <div>
                <h2 className="text-lg font-semibold">
                  {row.patient.firstName} {row.patient.lastName}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {patient ? (
                    <>
                      {ageFromBirth(patient.birthDate)} {t('detail.yearsOld')} ·{' '}
                      {t(`gender.${patient.gender}`)}
                      {maskIdentity(patient) && <> · TC {maskIdentity(patient)}</>}
                      {maskPhone(patient) && <> · {maskPhone(patient)}</>}
                    </>
                  ) : patientLoading ? (
                    '…'
                  ) : (
                    row.patient.mrn
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {/* #1152 — acil (kritik) + VIP (amber) öncelik göstergesi; ikon + metin. */}
                {row.isUrgent && (
                  <span
                    className="inline-flex items-center gap-1 rounded-badge border border-critical-border bg-critical-bg px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-critical-foreground"
                    title={row.urgentReason ?? undefined}
                  >
                    <Siren className="h-3.5 w-3.5" aria-hidden />
                    {t('priority.urgent')}
                  </span>
                )}
                {vip && (
                  <span className="inline-flex items-center gap-1 rounded-badge border border-warning-border bg-warning-bg px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-warning-foreground">
                    <Star className="h-3.5 w-3.5" aria-hidden />
                    {t('priority.vip')}
                  </span>
                )}
                <span className="inline-flex items-center rounded-badge bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {reason}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {apptTime && (
                  <span className="tabular-nums">
                    {t('detail.appointmentAt')} {apptTime} ·{' '}
                  </span>
                )}
                {t('detail.arrival')} {fmtTime(row.openedAt)}
                {patient?.leadSourceNote ? ` · ${patient.leadSourceNote}` : ''}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Öykü + Ölçüm */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-background p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <FileText className="h-4 w-4" aria-hidden />
            {t('detail.history')}
          </h3>
          {latestExam && (latestExam.chiefComplaint || latestExam.history) ? (
            <p className="text-sm leading-relaxed">
              {latestExam.chiefComplaint}
              {latestExam.chiefComplaint && latestExam.history ? ' ' : ''}
              {latestExam.history}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('detail.noHistory')}</p>
          )}
          {/* #388 — son muayene bulguları (VA/ön segment/fundus) öykü kartında. */}
          {latestExam?.findings && (
            <FindingsView findings={latestExam.findings} className="mt-3 border-t pt-3" />
          )}
        </div>

        <div className="rounded-xl border bg-background p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <FlaskConical className="h-4 w-4" aria-hidden />
              {t('detail.measurements')}
            </h3>
            {measRows.length > 0 && latestMeasAt && (
              <Badge variant="success" dot>
                {t('detail.ready')} · {fmtTime(latestMeasAt)}
              </Badge>
            )}
          </div>
          {measRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('detail.noMeasurements')}</p>
          ) : (
            <Table className="w-full text-sm">
              <TableHeader>
                <TableRow className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <TableHead className="pb-1 font-medium">{t('detail.col.test')}</TableHead>
                  <TableHead className="pb-1 text-right font-medium">
                    {t('detail.col.right')}
                  </TableHead>
                  <TableHead className="pb-1 text-right font-medium">
                    {t('detail.col.left')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {measRows.map((mr) => {
                  const slot = byType[mr.type];
                  // S16 — eşik-abnormal VEYA hemşirenin manuel bayrağı (values.flagged) → kırmızı.
                  const odAb = mr.abnormal?.(slot.od) || slot.od?.flagged === true;
                  const osAb = mr.abnormal?.(slot.os) || slot.os?.flagged === true;
                  return (
                    <TableRow key={mr.type} className="border-t">
                      <TableCell className="py-1.5 text-muted-foreground">
                        {t(mr.labelKey)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'py-1.5 text-right tabular-nums',
                          odAb && 'font-medium text-critical-foreground',
                        )}
                      >
                        {mr.fmt(slot.od)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'py-1.5 text-right tabular-nums',
                          osAb && 'font-medium text-critical-foreground',
                        )}
                      >
                        {mr.fmt(slot.os)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Aksiyonlar — izinle kapılı (hemşire salt-okunur) */}
      {hasAnyAction && (
        <div className="flex flex-wrap items-center gap-2">
          {/* #387 — waiting_doctor → birincil "Muayeneye Al"; cap'teyken disabled. */}
          {canStartExam && (
            <Button
              onClick={onStartExam}
              disabled={startingExam || atCap}
              title={atCap ? t('action.capReachedHint') : undefined}
            >
              {startingExam ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Stethoscope className="mr-1.5 h-4 w-4" />
              )}
              {t('action.startExam')}
            </Button>
          )}
          {/* #379 — measurement_ready → birincil "Geri çağır" (ölçüm bitti, muayeneye al). */}
          {canRecall && (
            <Button onClick={onRecall} disabled={recalling}>
              {recalling ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Stethoscope className="mr-1.5 h-4 w-4" />
              )}
              {t('action.recall')}
            </Button>
          )}
          {can['action:measurementOrder.create'] && (
            <Button
              variant={canStartExam || canRecall ? 'outline' : 'default'}
              onClick={onNewMeasurement}
            >
              <FlaskConical className="mr-1.5 h-4 w-4" />
              {t('action.newMeasurement')}
            </Button>
          )}
          {can['action:prescription.create'] && (
            <Button variant="outline" onClick={onPrescription}>
              <FileText className="mr-1.5 h-4 w-4" />
              {t('action.prescription')}
            </Button>
          )}
          {can['action:surgery.create'] && (
            <Button
              variant="outline"
              onClick={onSuggestSurgery}
              className="border-warning-border text-warning-foreground hover:bg-warning-bg"
            >
              <Scissors className="mr-1.5 h-4 w-4" />
              {t('action.suggestSurgery')}
            </Button>
          )}
          {can['action:encounter.close'] && (
            <Button
              variant="outline"
              className="ml-auto"
              onClick={onComplete}
              disabled={completing || !completeEnabled}
              title={!completeEnabled ? t('action.completeStageHint') : undefined}
            >
              {completing ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
              )}
              {t('action.complete')}
            </Button>
          )}
        </div>
      )}

      {/* Geçmiş muayeneler (varsa) — en güncel hariç, hastanın önceki muayeneleri */}
      {pastExams.length > 0 && (
        <div className="rounded-xl border bg-background p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ClipboardList className="h-4 w-4" aria-hidden />
            {t('detail.pastExams')}
          </h3>
          <ul className="divide-y">
            {pastExams.map((ex) => {
              const open = expandedExamId === ex.id;
              const daySurgeries = surgeries.filter((s) =>
                isSameDay(s.performedAt ?? s.scheduledAt, ex.examinedAt),
              );
              const dayMeasurements = measurements.filter((m) =>
                isSameDay(m.measuredAt, ex.examinedAt),
              );
              const hasProcedures = daySurgeries.length > 0 || dayMeasurements.length > 0;
              const hasDetail =
                !!ex.chiefComplaint ||
                !!ex.history ||
                !!ex.treatmentPlan ||
                !!ex.prescription ||
                hasProcedures;
              return (
                <li key={ex.id} className="py-1">
                  <button
                    type="button"
                    onClick={() => setExpandedExamId(open ? null : ex.id)}
                    aria-expanded={open}
                    className="flex w-full items-start justify-between gap-3 rounded-lg py-1.5 text-left hover:bg-muted/50"
                  >
                    <span className="flex min-w-0 items-start gap-1.5">
                      <ChevronRight
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                          open && 'rotate-90',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {ex.diagnosis || ex.chiefComplaint || '—'}
                        </span>
                        {hasProcedures && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {[
                              daySurgeries.length > 0 &&
                                `${t('detail.surgery')} (${daySurgeries.length})`,
                              dayMeasurements.length > 0 &&
                                `${t('detail.measurement')} (${dayMeasurements.length})`,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                      {fmtDate(ex.examinedAt)}
                    </span>
                  </button>

                  {open && (
                    <div className="ml-5 space-y-2 border-l pb-2 pl-3 pt-1">
                      {ex.chiefComplaint && (
                        <DetailLine label={t('detail.complaint')} value={ex.chiefComplaint} />
                      )}
                      {ex.history && (
                        <DetailLine label={t('detail.historyLabel')} value={ex.history} />
                      )}
                      {/* #388 — geçmiş muayene bulguları expand'da okunur. */}
                      {ex.findings && <FindingsView findings={ex.findings} />}
                      {ex.treatmentPlan && (
                        <DetailLine label={t('detail.treatmentPlan')} value={ex.treatmentPlan} />
                      )}
                      {ex.prescription && (
                        <DetailLine label={t('detail.prescription')} value={ex.prescription} />
                      )}

                      {hasProcedures && (
                        <div className="pt-0.5">
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {t('detail.procedures')}
                          </div>
                          <ul className="space-y-1">
                            {daySurgeries.map((s) => (
                              <li key={s.id} className="flex items-center gap-1.5 text-xs">
                                <Scissors
                                  className="h-3.5 w-3.5 shrink-0 text-warning-foreground"
                                  aria-hidden
                                />
                                <span className="font-medium">{t('detail.surgery')}:</span>
                                <span className="truncate">
                                  {s.type}
                                  {s.eyeSide ? ` · ${s.eyeSide.toUpperCase()}` : ''} ·{' '}
                                  {s.performedAt ? t('detail.done') : t('detail.planned')}
                                </span>
                              </li>
                            ))}
                            {dayMeasurements.length > 0 && (
                              <li className="flex items-center gap-1.5 text-xs">
                                <FlaskConical
                                  className="h-3.5 w-3.5 shrink-0 text-primary"
                                  aria-hidden
                                />
                                <span className="font-medium">{t('detail.measurement')}:</span>
                                <span>{dayMeasurements.length}</span>
                              </li>
                            )}
                          </ul>
                        </div>
                      )}

                      {!hasDetail && (
                        <p className="text-xs text-muted-foreground">{t('detail.noExtra')}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}: </span>
      <span>{value}</span>
    </div>
  );
}
