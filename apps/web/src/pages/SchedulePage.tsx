import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Plus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { type AppointmentCardData } from '../components/schedule/AppointmentCard';
import { AppointmentDetailSheet } from '../components/schedule/AppointmentDetailSheet';
import {
  AppointmentDialog,
  type ExistingAppointment,
  type PrefilledPatient,
} from '../components/schedule/AppointmentDialog';
import { SeriesAppointmentDialog } from '../components/schedule/SeriesAppointmentDialog';
import { DailySlotGrid, type ClosedOverlay } from '../components/schedule/DailySlotGrid';
import { DateNavigator } from '../components/schedule/DateNavigator';
import { DoctorFilter } from '../components/schedule/DoctorFilter';
import { TypeFilter } from '../components/schedule/TypeFilter';
import { WeeklyGrid } from '../components/schedule/WeeklyGrid';
import { Button } from '../components/ui/button';
import {
  APPOINTMENT_TYPES,
  type AppointmentStatus,
  type AppointmentType,
} from '../lib/appointment.constants';
import {
  boundsFromWorkingHours,
  dayBoundsISO,
  startOfDay,
  startOfWeek,
  weekBoundsISO,
} from '../lib/schedule.utils';
import { ROLES } from '@airmed/contracts';
import { useClinic } from '../hooks/useClinic';
import { usePermission } from '../hooks/usePermission';
import { trpc } from '../lib/trpc';
import { useAuth } from '../providers/AuthProvider';
import { useLocale } from '../providers/LocaleProvider';

type ViewMode = 'daily' | 'weekly';
// Madde 4 — yönetici Klinik Ayarları'ndan farklı varsayılan girmediyse 30 dk.
const FALLBACK_SLOT_MINUTES = 30;

export function SchedulePage() {
  const { t } = useTranslation(['appointment', 'common']);
  const { locale } = useLocale();
  const { user } = useAuth();
  const clinic = useClinic();
  const slotMinutes = clinic.defaultAppointmentMinutes ?? FALLBACK_SLOT_MINUTES;
  const [searchParams, setSearchParams] = useSearchParams();

  const [view, setView] = useState<ViewMode>('daily');
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [selectedDoctorIds, setSelectedDoctorIds] = useState<string[]>([]);

  // S15 — Giriş yapan doktor (admin değil) için takvim varsayılan olarak kendi
  // hastalarına filtrelenir. Bir kez set edilir; kullanıcı sonra serbestçe değiştirir.
  // Doktor takvimi görür ama yeni randevu veremez + doktor listesini çekemez.
  const canCreateAppointment = usePermission('action:appointment.create');
  const canListDoctors = usePermission('action:doctor.list');
  const isAdminViewer = !!user?.roles.some(
    (r) => r === ROLES.YONETICI || r === ROLES.YONETICI_ASISTANI,
  );
  // Sadece-doktor (başka klinik/admin rolü yok) → tip rehberi gizlenir.
  const isDoctorOnly =
    !!user &&
    user.roles.includes(ROLES.DOKTOR) &&
    !user.roles.some((r) =>
      (
        [
          ROLES.YONETICI,
          ROLES.YONETICI_ASISTANI,
          ROLES.RESEPSIYON,
          ROLES.HEMSIRE,
          ROLES.AMELIYAT_SATIS,
        ] as string[]
      ).includes(r),
    );
  const myProfile = trpc.doctor.myProfile.useQuery(undefined, { enabled: !isAdminViewer });
  const doctorDefaultApplied = useRef(false);
  useEffect(() => {
    if (doctorDefaultApplied.current || isAdminViewer) return;
    if (myProfile.data?.id) {
      setSelectedDoctorIds([myProfile.data.id]);
      doctorDefaultApplied.current = true;
    }
  }, [myProfile.data, isAdminViewer]);
  const [selectedTypes, setSelectedTypes] = useState<AppointmentType[]>([...APPOINTMENT_TYPES]);

  const [createSlot, setCreateSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [prefilledPatient, setPrefilledPatient] = useState<PrefilledPatient | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Edit mode için: detail panelinden tıklanan randevuyu çek (full include).
  // findById zaten patient + doctor include ediyor, dialog için ihtiyacımız olan
  // tüm shape orada.
  const editingDetail = trpc.appointment.findById.useQuery(
    { id: editingId ?? '' },
    { enabled: !!editingId },
  );

  const range = useMemo(
    () => (view === 'daily' ? dayBoundsISO(selectedDate) : weekBoundsISO(selectedDate)),
    [view, selectedDate],
  );

  const doctorsQuery = trpc.doctor.list.useQuery(
    {
      isActive: true,
      page: 1,
      pageSize: 200,
    },
    { enabled: canListDoctors },
  );

  const rangeQuery = trpc.appointment.findInRange.useQuery({
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
  });

  // İzin overlay'i sadece tek doktor filtresinde gösterilir; "tüm doktorlar"
  // görünümünde bir cell birden çok doktorun overlap'ini gizler → kafa karıştırır.
  const singleDoctorId = selectedDoctorIds.length === 1 ? selectedDoctorIds[0]! : null;
  const leavesQuery = trpc.doctor.findLeavesInRange.useQuery(
    {
      doctorId: singleDoctorId ?? undefined,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    },
    { enabled: !!singleDoctorId },
  );

  const leaves = useMemo(
    () =>
      (leavesQuery.data ?? []).map((l) => ({
        id: l.id,
        startsAt: new Date(l.startsAt),
        endsAt: new Date(l.endsAt),
        reason: l.reason ?? null,
      })),
    [leavesQuery.data],
  );

  // #1048 — Seçili tek doktor misafir mi? Yönetici/resepsiyon doctor.list'ten,
  // sadece-doktor kullanıcı kendi myProfile'ından bilir.
  const singleDoctorIsVisiting = useMemo(() => {
    if (!singleDoctorId) return false;
    const fromList = doctorsQuery.data?.items.find((d) => d.id === singleDoctorId);
    if (fromList) return fromList.type === 'visiting';
    return myProfile.data?.id === singleDoctorId && myProfile.data.type === 'visiting';
  }, [singleDoctorId, doctorsQuery.data, myProfile.data]);

  const windowsQuery = trpc.doctor.findVisitingWindowsInRange.useQuery(
    {
      doctorId: singleDoctorId ?? undefined,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    },
    { enabled: !!singleDoctorId && singleDoctorIsVisiting },
  );

  // #1048 — Pencere KOMPLEMANI: görünür aralıkta pencere DIŞI kalan dilimler
  // gri overlay olur. Pencere hiç yoksa tüm aralık kapalı (misafir doktor
  // varsayılan kapalı, #1047). Query yüklenene kadar overlay çizilmez —
  // yanlışlıkla "her yer kapalı" göstermeyelim.
  const closed = useMemo<ClosedOverlay[] | undefined>(() => {
    if (!singleDoctorIsVisiting || !windowsQuery.data) return undefined;
    const rangeStart = new Date(range.dateFrom);
    const rangeEnd = new Date(range.dateTo);
    const windows = windowsQuery.data
      .map((w) => ({ start: new Date(w.startsAt), end: new Date(w.endsAt) }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const gaps: ClosedOverlay[] = [];
    let cursor = rangeStart;
    for (const w of windows) {
      if (w.start > cursor) {
        gaps.push({ id: `closed-${gaps.length}`, startsAt: cursor, endsAt: w.start });
      }
      if (w.end > cursor) cursor = w.end;
    }
    if (cursor < rangeEnd) {
      gaps.push({ id: `closed-${gaps.length}`, startsAt: cursor, endsAt: rangeEnd });
    }
    return gaps;
  }, [singleDoctorIsVisiting, windowsQuery.data, range.dateFrom, range.dateTo]);

  // Hasta detay sayfasından deep-link: /schedule?patientId=...
  // Hastayı `patient.findById` ile çek, dialog'u prefilled aç. Bir kez kullan,
  // sonra param'ı temizle ki kullanıcı dialog kapatınca tekrar açılmasın.
  const patientIdParam = searchParams.get('patientId');
  const patientPrefill = trpc.patient.findById.useQuery(
    { id: patientIdParam ?? '' },
    { enabled: !!patientIdParam, retry: false },
  );

  // #1048 — type: AppointmentDialog erken-uyarı (pencere/izin) doktor tipini bilsin.
  const doctorOptions = useMemo(
    () => doctorsQuery.data?.items.map((d) => ({ id: d.id, name: d.name, type: d.type })) ?? [],
    [doctorsQuery.data],
  );

  const defaultDoctorId = useMemo(() => {
    if (selectedDoctorIds.length === 1) return selectedDoctorIds[0]!;
    return doctorOptions[0]?.id ?? null;
  }, [selectedDoctorIds, doctorOptions]);

  // Patient deep-link: ilk başarılı hasta yüklemesinde dialog'u aç ve URL param'ı temizle.
  useEffect(() => {
    if (!patientIdParam || !patientPrefill.data || !defaultDoctorId) return;
    const start = new Date(selectedDate);
    const now = new Date();
    start.setHours(now.getHours(), Math.floor(now.getMinutes() / 30) * 30, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + slotMinutes);
    const p = patientPrefill.data;
    setPrefilledPatient({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      mrn: p.mrn,
    });
    setCreateSlot({ start, end });
    // URL'i temizle ki kullanıcı dialog kapatınca tekrar tetiklenmesin.
    const next = new URLSearchParams(searchParams);
    next.delete('patientId');
    setSearchParams(next, { replace: true });
  }, [
    patientIdParam,
    patientPrefill.data,
    defaultDoctorId,
    selectedDate,
    searchParams,
    setSearchParams,
  ]);

  const filtered: AppointmentCardData[] = useMemo(() => {
    if (!rangeQuery.data) return [];
    return rangeQuery.data
      .filter((a) => {
        // #367 — Doktorsuz (havuz) randevu doktor filtresinde gizlenir (yalnız
        // "tüm doktorlar" görünümünde / havuz görünümünde gösterilir).
        if (
          selectedDoctorIds.length > 0 &&
          (!a.doctorId || !selectedDoctorIds.includes(a.doctorId))
        )
          return false;
        if (!selectedTypes.includes(a.type as AppointmentType)) return false;
        return true;
      })
      .map((a) => ({
        id: a.id,
        type: a.type as AppointmentType,
        status: a.status as AppointmentStatus,
        startsAt: new Date(a.startsAt),
        endsAt: new Date(a.endsAt),
        patientLabel: a.patient
          ? `${a.patient.firstName} ${a.patient.lastName} · ${a.patient.mrn}`
          : undefined,
        doctorId: a.doctorId,
        doctorName: a.doctor?.name ?? null,
      }));
  }, [rangeQuery.data, selectedDoctorIds, selectedTypes]);

  const openCreateAt = (start: Date) => {
    if (!defaultDoctorId) return;
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + slotMinutes);
    setCreateSlot({ start, end });
  };

  const openCreateNow = () => {
    const start = new Date(selectedDate);
    const now = new Date();
    start.setHours(now.getHours(), Math.floor(now.getMinutes() / 30) * 30, 0, 0);
    openCreateAt(start);
  };

  const closeCreateDialog = () => {
    setCreateSlot(null);
    setPrefilledPatient(null);
  };

  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);

  // #1048 — grid saat aralığı klinik mesai ayarından (tüm günlerin
  // min-start/max-end üst-limiti); ayar yoksa 09-18 sabitleri.
  const scheduleBounds = useMemo(
    () => boundsFromWorkingHours(clinic.workingHours),
    [clinic.workingHours],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('appointment:page.title')}
        description={t('appointment:page.description')}
        actions={
          canCreateAppointment ? (
            <div className="flex items-center gap-2">
              {/* #383 — Seri randevu: çok hastayı ardışık ayrı slotlara dağıt. */}
              <Button
                variant="outline"
                onClick={() => setSeriesOpen(true)}
                disabled={!defaultDoctorId}
                data-testid="schedule-series"
              >
                <Users className="mr-2 h-4 w-4" />
                {t('appointment:series.button', { defaultValue: 'Seri Randevu' })}
              </Button>
              <Button
                onClick={openCreateNow}
                disabled={!defaultDoctorId}
                data-testid="schedule-new"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('appointment:page.newAppointment')}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <DateNavigator selectedDate={selectedDate} locale={locale} onChange={setSelectedDate} />
        <div className="flex items-center gap-2" aria-label="view-switcher">
          <Button
            variant={view === 'daily' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('daily')}
            data-testid="schedule-view-daily"
          >
            {t('appointment:view.daily')}
          </Button>
          <Button
            variant={view === 'weekly' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('weekly')}
            data-testid="schedule-view-weekly"
          >
            {t('appointment:view.weekly')}
          </Button>
        </div>
        {/* Doktor filtresi sadece-doktorda gizli (takvim zaten kendine filtreli). */}
        {!isDoctorOnly && (
          <DoctorFilter
            doctors={doctorOptions}
            selectedIds={selectedDoctorIds}
            isLoading={doctorsQuery.isLoading}
            onChange={setSelectedDoctorIds}
          />
        )}
      </div>

      <TypeFilter selected={selectedTypes} onChange={setSelectedTypes} />

      {rangeQuery.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t('appointment:page.loadFailed', { message: rangeQuery.error.message })}
        </div>
      )}

      {rangeQuery.isLoading ? (
        <div className="rounded-md border bg-card p-10 text-center text-sm text-muted-foreground">
          {t('appointment:page.loading')}
        </div>
      ) : view === 'daily' ? (
        filtered.length === 0 ? (
          <div className="rounded-md border bg-card p-10" data-testid="schedule-empty">
            <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
              <CalendarDays className="h-10 w-10 opacity-40" aria-hidden="true" />
              <p>{t('appointment:page.empty')}</p>
              {canCreateAppointment && defaultDoctorId && (
                <Button variant="outline" size="sm" onClick={openCreateNow}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('appointment:page.newAppointment')}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <DailySlotGrid
            appointments={filtered}
            selectedDate={selectedDate}
            locale={locale}
            leaves={singleDoctorId ? leaves : undefined}
            closed={closed}
            bounds={scheduleBounds}
            onCardClick={setDetailId}
            onSlotClick={canCreateAppointment && defaultDoctorId ? openCreateAt : undefined}
          />
        )
      ) : (
        <WeeklyGrid
          weekStart={weekStart}
          appointments={filtered}
          locale={locale}
          leaves={singleDoctorId ? leaves : undefined}
          closed={closed}
          bounds={scheduleBounds}
          onCardClick={setDetailId}
          onSlotClick={canCreateAppointment && defaultDoctorId ? openCreateAt : undefined}
        />
      )}

      {createSlot && defaultDoctorId && (
        <AppointmentDialog
          open={!!createSlot}
          onOpenChange={(open) => !open && closeCreateDialog()}
          defaultStartsAt={createSlot.start}
          defaultEndsAt={createSlot.end}
          defaultDoctorId={defaultDoctorId}
          doctorOptions={doctorOptions}
          prefilledPatient={prefilledPatient}
          onCreated={closeCreateDialog}
        />
      )}

      {editingId && editingDetail.data && (
        <AppointmentDialog
          open={!!editingId}
          onOpenChange={(open) => !open && setEditingId(null)}
          mode="edit"
          defaultStartsAt={new Date(editingDetail.data.startsAt)}
          defaultEndsAt={new Date(editingDetail.data.endsAt)}
          defaultDoctorId={editingDetail.data.doctorId ?? ''}
          doctorOptions={doctorOptions}
          existing={toExistingAppointment(editingDetail.data)}
          onCreated={() => setEditingId(null)}
          onUpdated={() => setEditingId(null)}
        />
      )}

      {seriesOpen && defaultDoctorId && (
        <SeriesAppointmentDialog
          open={seriesOpen}
          onOpenChange={setSeriesOpen}
          doctors={doctorOptions}
          defaultDoctorId={defaultDoctorId}
          defaultDate={selectedDate}
          onDone={() => void rangeQuery.refetch()}
        />
      )}

      <AppointmentDetailSheet
        appointmentId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(id) => {
          setDetailId(null);
          setEditingId(id);
        }}
      />
    </div>
  );
}

interface FindByIdShape {
  id: string;
  patient: { id: string; firstName: string; lastName: string; mrn: string };
  doctorId: string | null;
  type: string;
  startsAt: string | Date;
  endsAt: string | Date;
  notes: string | null;
}

function toExistingAppointment(d: FindByIdShape): ExistingAppointment {
  return {
    id: d.id,
    patient: {
      id: d.patient.id,
      firstName: d.patient.firstName,
      lastName: d.patient.lastName,
      mrn: d.patient.mrn,
    },
    doctorId: d.doctorId,
    type: d.type as AppointmentType,
    startsAt: new Date(d.startsAt),
    endsAt: new Date(d.endsAt),
    notes: d.notes ?? null,
  };
}
