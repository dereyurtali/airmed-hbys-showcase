import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { localeToIntl } from '../lib/i18n-format';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CreditCard,
  Flag,
  Loader2,
  Paperclip,
  PencilRuler,
  Search,
  SendHorizonal,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState } from '../components/ui/empty-state';
import { PhotoUpload } from '../components/photo/PhotoUpload';
import { cn } from '../lib/utils';
import type { MeasurementOrderStatus } from '../lib/measurement-order.constants';
import type { MeasurementType } from '../lib/measurement.constants';
import { trpc } from '../lib/trpc';
import { mapTrpcError } from '../lib/trpc-error';
import { usePermission } from '../hooks/usePermission';
import { useConfirm } from '../hooks/useConfirm';
import { useLocale } from '../providers/LocaleProvider';

// S16 + #390 — Ölçüm tipi → ÇOK-ALANLI giriş yapılandırması. fields[].key =
// Measurement.values içindeki anahtar (doktor WorklistPage MEAS_ROWS ile birebir
// aynı: refraction sph/cyl/axis, keratometri K1/K2/axis). Tek-alanlı şema doktor
// ekranında "−2.25 / undefined × undefined°" üretiyordu — artık tüm alanlar
// girilir. label = klinik kısaltma (dil-nötr: Sph/Cyl/Axis/K1/K2). abbr = liste
// çipi. unit = input son-eki.
type MeasurementFieldDef = { key: string; label: string; unit?: string };
const ENTRY_CONFIG: Record<string, { fields: MeasurementFieldDef[]; abbr: string }> = {
  visual_acuity: { abbr: 'VA', fields: [{ key: 'decimal', label: 'Decimal' }] },
  intraocular_pressure: { abbr: 'GİB', fields: [{ key: 'mmHg', label: 'mmHg', unit: 'mmHg' }] },
  biometry: { abbr: 'BİO', fields: [{ key: 'axialLength', label: 'AL', unit: 'mm' }] },
  keratometry: {
    abbr: 'KER',
    fields: [
      { key: 'k1', label: 'K1', unit: 'D' },
      { key: 'k2', label: 'K2', unit: 'D' },
      { key: 'axis', label: 'Axis', unit: '°' },
    ],
  },
  refraction: {
    abbr: 'AR',
    fields: [
      { key: 'sphere', label: 'Sph', unit: 'D' },
      { key: 'cylinder', label: 'Cyl', unit: 'D' },
      { key: 'axis', label: 'Axis', unit: '°' },
    ],
  },
  topography: { abbr: 'TOP', fields: [{ key: 'value', label: '' }] },
  pachymetry: { abbr: 'PAK', fields: [{ key: 'value', label: '', unit: 'µm' }] },
  perimetry: { abbr: 'PER', fields: [{ key: 'value', label: '' }] },
  fundus_photo: { abbr: 'FUN', fields: [{ key: 'value', label: '' }] },
  oct: { abbr: 'OKT', fields: [{ key: 'value', label: '' }] },
};

function entryConfig(type: string) {
  return (
    ENTRY_CONFIG[type] ?? {
      abbr: type.slice(0, 3).toUpperCase(),
      fields: [{ key: 'value', label: '' }] as MeasurementFieldDef[],
    }
  );
}

// Salt-okunur görünüm: bir gözün values kaydını "Sph −2.25 · Cyl −1.00 · Axis 90°"
// şeklinde formatlar. Eksik alanlar atlanır (undefined render YOK). Hiç değer yoksa —.
function formatEyeValues(
  fields: MeasurementFieldDef[],
  rec: Record<string, unknown> | null | undefined,
): string {
  if (!rec) return '—';
  const parts = fields
    .map((f) => {
      const raw = rec[f.key];
      if (raw == null || String(raw).trim() === '') return null;
      const prefix = f.label ? `${f.label} ` : '';
      return `${prefix}${raw}${f.unit ?? ''}`;
    })
    .filter((p): p is string => p !== null);
  return parts.length ? parts.join(' · ') : '—';
}

interface MeasurementRow {
  id: string;
  type: string;
  eyeSide: 'od' | 'os' | 'ou';
  values: Record<string, unknown> | null;
}

interface OrderRow {
  id: string;
  status: MeasurementOrderStatus;
  requestedTypes: string[];
  requiresPayment: boolean;
  createdAt: string;
  fulfilledAt?: string | null;
  doctorName?: string | null;
  notes?: string | null;
  patient: {
    id: string;
    mrn: string;
    firstName: string;
    lastName: string;
    birthDate?: string | null;
    gender?: string | null;
  };
  encounter?: {
    id: string;
    stage: string;
    appointment?: { notes: string | null; startsAt: string; type: string } | null;
  } | null;
  measurements?: MeasurementRow[];
}

/** İsimden iki harf baş harf (avatar). */
function initials(first: string, last: string): string {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

function ageFrom(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}

// #363 — yeni talep sesli uyarısı. Kısa Web Audio "ding" (asset gerektirmez).
// Tarayıcı autoplay/AudioContext kısıtı veya destek yoksa sessizce yutulur.
function playChime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.42);
    osc.onended = () => void ctx.close();
  } catch {
    // ses kritik değil — görsel toast zaten var
  }
}

// type → {od?: values, os?: values} (tamamlanan görünümde girilmiş değerler).
function pivot(
  measurements: MeasurementRow[],
): Record<string, { od?: Record<string, unknown>; os?: Record<string, unknown> }> {
  const map: Record<string, { od?: Record<string, unknown>; os?: Record<string, unknown> }> = {};
  for (const m of measurements) {
    const slot = (map[m.type] ??= {});
    if (m.eyeSide === 'od') slot.od ??= m.values ?? {};
    else if (m.eyeSide === 'os') slot.os ??= m.values ?? {};
    else if (m.eyeSide === 'ou') {
      slot.od ??= m.values ?? {};
      slot.os ??= m.values ?? {};
    }
  }
  return map;
}

interface EntryState {
  od: Record<string, string>;
  os: Record<string, string>;
  flagged: boolean;
}

/**
 * S16 — Ölçüm Talepleri (ölçüm hemşiresi istasyonu): iki-panel master-detail.
 * Sol "Gelen Talepler" listesi (test çipleri), sağ detay + test başına SAĞ(OD)/
 * SOL(OS) giriş + bayrak (patolojik → doktorda kırmızı) + "Doktora Gönder".
 * mode='completed' → bugün tamamlananlar, salt-okunur.
 */
export function MeasurementQueuePage({ mode = 'pending' }: { mode?: 'pending' | 'completed' }) {
  const { t } = useTranslation(['measurementOrder', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';
  const { confirm } = useConfirm();
  const utils = trpc.useUtils();
  const completed = mode === 'completed';
  const canFulfill = usePermission('action:measurementOrder.fulfill');
  // R2 (#724) — pending modda "Aktif | Ertelenmiş" görünüm toggle'ı.
  const [view, setView] = useState<'active' | 'deferred'>('active');
  const deferredView = !completed && view === 'deferred';
  const readOnly = completed || deferredView || !canFulfill;

  const queue = trpc.measurementOrder.listForUnit.useQuery(
    completed ? { completedToday: true } : deferredView ? { status: 'deferred' } : {},
    { refetchInterval: 10_000 },
  );
  const rows = (queue.data ?? []) as unknown as OrderRow[];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;

  // Dirty-guard: DetailPanel reports unsaved typed values; switching cards then
  // prompts before discarding them (key remount would silently wipe otherwise).
  const dirtyRef = useRef(false);
  const handleSelect = async (id: string) => {
    if (id === selected?.id) return;
    if (dirtyRef.current && !(await confirm({ message: t('detail.unsavedConfirm') }))) return;
    dirtyRef.current = false;
    setSelectedId(id);
  };

  // #376 — Tip-bazlı filtre (çok-istasyonlu kurgu). Sekmeler kuyrukta mevcut
  // tiplerden türetilir; seçili tip client-side süzer (anlık geçiş, refetch yok).
  const presentTypes = useMemo(
    () => [...new Set(rows.flatMap((r) => r.requestedTypes))].sort(),
    [rows],
  );
  // Seçili tip kuyruktan kalkınca "Tümü"e düş.
  useEffect(() => {
    if (typeFilter && !presentTypes.includes(typeFilter)) setTypeFilter(null);
  }, [typeFilter, presentTypes]);

  const q = search.trim().toLocaleLowerCase(dateLocale);
  const filteredRows = rows.filter((r) => {
    if (typeFilter && !r.requestedTypes.includes(typeFilter)) return false;
    if (!q) return true;
    const name = `${r.patient.firstName} ${r.patient.lastName}`.toLocaleLowerCase(dateLocale);
    const mrn = r.patient.mrn.toLocaleLowerCase(dateLocale);
    return name.includes(q) || mrn.includes(q);
  });

  // Liste değişince seçim geçerli kalsın; yoksa ilk satıra düş.
  useEffect(() => {
    if (rows.length === 0) {
      if (selectedId !== null) setSelectedId(null);
    } else if (!rows.some((r) => r.id === selectedId)) {
      setSelectedId(rows[0].id);
    }
  }, [rows, selectedId]);

  // #363 — Yeni talep uyarısı: WS invalidate sonrası kuyruk sayısı artınca
  // sesli "ding" + görsel toast (istasyon ekranına bakmayan hemşire de duysun).
  // İlk yükleme atlanır (prevCount=null); yalnız pending modda çalışır.
  const prevCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (completed || queue.isLoading) return;
    const count = rows.length;
    const prev = prevCountRef.current;
    prevCountRef.current = count;
    if (prev != null && count > prev) {
      playChime();
      toast.info(t('queue.newOrderToast'));
    }
  }, [rows.length, completed, queue.isLoading, t]);

  const fmtTime = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' }) : '';
  const dateLabel = new Date().toLocaleDateString(dateLocale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  });

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-6 py-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {completed ? t('page.completedTitle') : t('queue.title')}
        </h1>
        <p className="text-sm capitalize text-muted-foreground">{dateLabel}</p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* Sol: Gelen Talepler */}
        <aside className="flex min-h-0 flex-col rounded-xl border bg-background">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-sm font-semibold">{t('queue.incoming')}</span>
            {rows.length > 0 && (
              <Badge variant="warning" dot>
                {rows.length}
              </Badge>
            )}
          </div>
          <div className="border-b p-2">
            {/* R2 (#724) — Aktif | Ertelenmiş görünüm toggle'ı (yalnız pending sayfası). */}
            {!completed && (
              <div className="mb-2 flex gap-1 rounded-lg bg-muted/50 p-1">
                {(['active', 'deferred'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setView(v);
                      setSelectedId(null);
                    }}
                    className={cn(
                      'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                      view === v
                        ? 'bg-background shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(`queue.view.${v}`)}
                  </button>
                ))}
              </div>
            )}
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('queue.searchPlaceholder')}
                className="focus-ring h-10 w-full rounded-lg border border-field bg-muted/40 pl-9 pr-3 text-sm hover:border-field-hover"
              />
            </div>
            {/* #376 — Tip filtresi sekmeleri (yalnız kuyrukta mevcut tipler). */}
            {presentTypes.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1">
                <TypeFilterChip
                  active={typeFilter === null}
                  label={t('queue.filterAll')}
                  onClick={() => setTypeFilter(null)}
                />
                {presentTypes.map((type) => (
                  <TypeFilterChip
                    key={type}
                    active={typeFilter === type}
                    label={typeLabel(type, t)}
                    onClick={() => setTypeFilter(type)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {queue.isLoading && <Skeleton className="h-16 w-full rounded-lg" />}
            {!queue.isLoading && filteredRows.length === 0 && (
              <EmptyState title={completed ? t('page.emptyCompleted') : t('queue.empty')} />
            )}
            {filteredRows.map((order) => (
              <QueueCard
                key={order.id}
                order={order}
                selected={selected?.id === order.id}
                onSelect={() => void handleSelect(order.id)}
                completed={completed}
                fmtTime={fmtTime}
                t={t}
              />
            ))}
          </div>
        </aside>

        {/* Sağ: Detay */}
        <section className="min-h-0 overflow-y-auto">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('detail.selectPrompt')}
            </div>
          ) : (
            <DetailPanel
              key={selected.id}
              order={selected}
              readOnly={readOnly}
              completed={completed}
              deferred={deferredView}
              fmtTime={fmtTime}
              onDirtyChange={(d) => {
                dirtyRef.current = d;
              }}
              onFulfilled={() => {
                void utils.measurementOrder.listForUnit.invalidate();
              }}
              t={t}
            />
          )}
        </section>
      </div>
    </div>
  );
}

type TFn = ReturnType<typeof useTranslation>['t'];

function typeLabel(type: string, t: TFn): string {
  // entry.types.<type> tanımlıysa onu kullan; yoksa kısa-kod fallback.
  const key = `measurementOrder:entry.types.${type}`;
  const label = t(key);
  return label === key ? entryConfig(type).abbr : label;
}

// #376 — Tip filtresi sekme çipi.
function TypeFilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-muted/70',
      )}
    >
      {label}
    </button>
  );
}

function QueueCard({
  order,
  selected,
  onSelect,
  completed,
  fmtTime,
  t,
}: {
  order: OrderRow;
  selected: boolean;
  onSelect: () => void;
  completed: boolean;
  fmtTime: (iso?: string | null) => string;
  t: TFn;
}) {
  const age = ageFrom(order.patient.birthDate);
  const time = completed ? order.fulfilledAt : order.createdAt;
  const subtitle = [
    order.doctorName,
    completed
      ? t('detail.completedAt', { time: fmtTime(time) })
      : t('detail.requestedShort', { time: fmtTime(time) }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/30'
          : 'border-transparent hover:bg-muted',
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {initials(order.patient.firstName, order.patient.lastName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {order.patient.firstName} {order.patient.lastName}
          {age != null && <span className="text-muted-foreground"> · {age}</span>}
        </span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">
          {order.patient.mrn}
        </span>
        {subtitle && (
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        )}
        <span className="mt-1 flex flex-wrap gap-1">
          {order.requestedTypes.map((type) => (
            <span
              key={type}
              className="inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {entryConfig(type).abbr}
            </span>
          ))}
        </span>
        {/* #391 — ödeme bekleyen talep kuyrukta amber rozetle işaretli; hemşire
            değer girmeden önce "tahsilat sonrası açılır" görür. */}
        {order.status === 'awaiting_payment' && (
          <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-badge border border-warning-border bg-warning-bg px-2 py-0.5 text-[10px] font-medium text-warning-foreground">
            <CreditCard className="h-3 w-3" aria-hidden />
            {t('status.awaitingPayment')}
          </span>
        )}
      </span>
    </button>
  );
}

function DetailPanel({
  order,
  readOnly,
  completed,
  deferred,
  fmtTime,
  onFulfilled,
  onDirtyChange,
  t,
}: {
  order: OrderRow;
  readOnly: boolean;
  completed: boolean;
  deferred?: boolean;
  fmtTime: (iso?: string | null) => string;
  onFulfilled: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  t: TFn;
}) {
  const [entries, setEntries] = useState<Record<string, EntryState>>({});
  const [showDeviceUpload, setShowDeviceUpload] = useState(false);
  const { confirm, promptText } = useConfirm();
  const utils = trpc.useUtils();

  // #407 — "Doktora Gönder" (measurementOrder.fulfill): karşılanan talep bekleyen
  // kuyruktan çıkar → satırı optimistik kaldır (anında tepki). Pending kuyruk
  // anahtarı {} (DetailPanel yalnız fulfill-edilebilir, yani pending modda render
  // olur; completed modda readOnly → submit hiç tetiklenmez). Hata → geri al.
  const fulfill = trpc.measurementOrder.fulfill.useMutation({
    onMutate: async (vars) => {
      await utils.measurementOrder.listForUnit.cancel();
      const prev = utils.measurementOrder.listForUnit.getData({});
      utils.measurementOrder.listForUnit.setData(
        {},
        (old) =>
          (old as unknown as OrderRow[] | undefined)?.filter((r) => r.id !== vars.orderId) as never,
      );
      return { prev };
    },
    onSuccess: () => {
      toast.success(t('fulfill.success'));
      onDirtyChange?.(false);
      onFulfilled();
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) utils.measurementOrder.listForUnit.setData({}, ctx.prev);
      toast.error(mapTrpcError(err, t));
    },
    onSettled: () => {
      void utils.measurementOrder.listForUnit.invalidate();
    },
  });

  // R2 (#724) — "Resepsiyona bildir": ödeme-bekleyen talepte hemşire resepsiyonu
  // yeniden uyarır (hasta odada, tahsilat yapılmadı). Backend dead-end değil.
  const notifyPayment = trpc.measurementOrder.notifyPayment.useMutation({
    onSuccess: () => toast.success(t('detail.receptionNotified')),
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });

  // R2 (#724) — "Ertele/Skip" + "Geri al" (deferred). Talep aktif kuyruktan çıkar
  // / döner; liste invalidate.
  const afterStatusChange = () => {
    onDirtyChange?.(false);
    onFulfilled();
    void utils.measurementOrder.listForUnit.invalidate();
  };
  const defer = trpc.measurementOrder.defer.useMutation({
    onSuccess: () => {
      toast.success(t('detail.deferred'));
      afterStatusChange();
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });
  const resume = trpc.measurementOrder.resume.useMutation({
    onSuccess: () => {
      toast.success(t('detail.resumed'));
      afterStatusChange();
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });
  const onDefer = async () => {
    const reason = await promptText({ message: t('detail.deferReasonPrompt') });
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error(t('detail.deferReasonTooShort'));
      return;
    }
    defer.mutate({ orderId: order.id, reason: reason.trim() });
  };

  const get = (type: string): EntryState => entries[type] ?? { od: {}, os: {}, flagged: false };
  const setFlag = (type: string, flagged: boolean) =>
    setEntries((prev) => ({
      ...prev,
      [type]: { ...(prev[type] ?? { od: {}, os: {}, flagged: false }), flagged },
    }));
  const setValue = (type: string, eye: 'od' | 'os', key: string, value: string) =>
    setEntries((prev) => {
      const cur = prev[type] ?? { od: {}, os: {}, flagged: false };
      return { ...prev, [type]: { ...cur, [eye]: { ...cur[eye], [key]: value } } };
    });
  const eyeHasValue = (rec: Record<string, string>) =>
    Object.values(rec).some((v) => v.trim() !== '');

  const measByType = useMemo(() => pivot(order.measurements ?? []), [order.measurements]);

  // Dirty = düzenlenebilir modda en az bir göz değeri girilmiş veya bayrak set.
  const isDirty =
    !readOnly &&
    Object.values(entries).some(
      (e) => eyeHasValue(e.od) || eyeHasValue(e.os) || e.flagged === true,
    );
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const age = ageFrom(order.patient.birthDate);
  const reason = order.encounter?.appointment?.notes ?? order.notes ?? null;
  const genderLabel = order.patient.gender ? t(`gender.${order.patient.gender}`) : null;

  // #391 — ödeme bekleyen talep: giriş kapalı (önce engelle, backend 403'ünü
  // bekletme). readOnly (tamamlanmış/yetkisiz) zaten ayrı; bu, fulfiller için
  // ÖDENMEMİŞ kuyruğu kapsar.
  const awaitingPayment = order.status === 'awaiting_payment';
  const paymentBlocked = !readOnly && awaitingPayment;

  const filledCount = order.requestedTypes.filter((type) => {
    const e = get(type);
    return eyeHasValue(e.od) || eyeHasValue(e.os);
  }).length;

  const submit = async () => {
    if (paymentBlocked) {
      toast.error(t('detail.paymentBlocked'));
      return;
    }
    const measurements: {
      type: MeasurementType;
      eyeSide: 'od' | 'os';
      values: Record<string, unknown>;
    }[] = [];
    const typesWithValue = new Set<string>();
    for (const type of order.requestedTypes) {
      const e = get(type);
      const cfg = entryConfig(type);
      const flag = e.flagged ? { flagged: true } : {};
      for (const eye of ['od', 'os'] as const) {
        const values: Record<string, unknown> = {};
        for (const f of cfg.fields) {
          // Klinik personeli ondalık virgül yazar (örn. -2,25) — sayısal ölçüm
          // alanlarında virgülü noktaya normalle (-2.25). #412.
          const v = (e[eye][f.key] ?? '').trim().replace(',', '.');
          if (v !== '') values[f.key] = v;
        }
        if (Object.keys(values).length > 0) {
          typesWithValue.add(type);
          measurements.push({
            type: type as MeasurementType,
            eyeSide: eye,
            values: { ...values, ...flag },
          });
        }
      }
    }
    if (measurements.length === 0) {
      toast.error(t('fulfill.noValues'));
      return;
    }
    // #412 — Kısmi gönderim onayı: istenen tiplerden en az biri tamamen boşsa
    // (hiç değer girilmemiş) gönderim öncesi onay iste. Tamamen dolu gönderimi
    // engelleme.
    if (
      typesWithValue.size < order.requestedTypes.length &&
      !(await confirm({ message: t('detail.partialConfirm') }))
    ) {
      return;
    }
    fulfill.mutate({ orderId: order.id, measurements });
  };

  return (
    <div className="space-y-4">
      {/* Hasta başlığı */}
      <div className="flex items-center gap-3 rounded-lg border bg-background p-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">
          {initials(order.patient.firstName, order.patient.lastName)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">
            {order.patient.firstName} {order.patient.lastName}
            {age != null && <span className="font-normal text-muted-foreground"> · {age}</span>}
            {genderLabel && (
              <span className="font-normal text-muted-foreground"> · {genderLabel}</span>
            )}
          </h2>
          <p className="truncate font-mono text-xs text-muted-foreground">{order.patient.mrn}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
            {reason && <span>{reason}</span>}
            {order.doctorName && <span>{order.doctorName}</span>}
            <span>
              {completed
                ? t('detail.completedAt', { time: fmtTime(order.fulfilledAt) })
                : t('detail.requestedAt', { time: fmtTime(order.createdAt) })}
            </span>
          </div>
        </div>
        {/* #426 — cihaz çıktısı (PDF/görüntü) iliştir: yalnız fulfiller modunda. */}
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setShowDeviceUpload(true)}
          >
            <Paperclip className="mr-1.5 h-4 w-4" aria-hidden />
            {t('detail.attachDeviceOutput')}
          </Button>
        )}
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-badge border px-3 py-1 text-xs font-medium',
            completed
              ? 'border-success-border bg-success-bg text-success-foreground'
              : 'border-warning-border bg-warning-bg text-warning-foreground',
          )}
        >
          {awaitingPayment && !completed ? (
            <CreditCard className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
          )}
          {completed
            ? t('detail.statusDone')
            : awaitingPayment
              ? t('status.awaitingPayment')
              : t('detail.statusWaiting')}
        </span>
      </div>

      {/* Ölçüm Girişi / Sonuçları */}
      <div className="rounded-lg border bg-background p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <PencilRuler className="h-4 w-4 text-primary" aria-hidden />
            {readOnly ? t('detail.resultsTitle') : t('detail.entryTitle')}
          </h3>
          {!readOnly && !paymentBlocked && (
            <span className="text-xs text-muted-foreground">
              {t('detail.entryHint', { count: order.requestedTypes.length })}
            </span>
          )}
        </div>

        {/* #391 — önce engelle: ödeme bekleyen talepte giriş alanları disabled +
            tahsilat sonrası notu (backend 403'üne kadar emek boşa gitmesin). */}
        {paymentBlocked && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning-foreground">
            <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{t('detail.paymentBlocked')}</span>
            {/* R2 (#724) — ödeme-gate dead-end değil: resepsiyona bildir aksiyonu. */}
            <Button
              size="sm"
              variant="outline"
              className="h-9 border-warning-border bg-background text-warning-foreground hover:bg-warning-bg"
              disabled={notifyPayment.isPending}
              onClick={() => notifyPayment.mutate({ orderId: order.id })}
            >
              {t('detail.notifyReception')}
            </Button>
          </div>
        )}

        <Table className="w-full">
          <TableHeader>
            <TableRow className="sticky top-0 z-10 bg-background text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <TableHead className="pb-2 font-medium">{t('detail.col.test')}</TableHead>
              <TableHead className="pb-2 font-medium">{t('detail.col.right')}</TableHead>
              <TableHead className="pb-2 font-medium">{t('detail.col.left')}</TableHead>
              <TableHead className="w-12 pb-2" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.requestedTypes.map((type) => {
              const cfg = entryConfig(type);
              const e = get(type);
              const slot = measByType[type];
              const odVal = formatEyeValues(cfg.fields, slot?.od);
              const osVal = formatEyeValues(cfg.fields, slot?.os);
              const flaggedStored = slot?.od?.flagged === true || slot?.os?.flagged === true;
              return (
                <TableRow key={type} className="border-t align-middle">
                  <TableCell className="py-2.5 pr-3 text-sm font-medium">
                    {typeLabel(type, t)}
                  </TableCell>
                  {readOnly ? (
                    <>
                      <TableCell className="py-2.5 pr-3 text-sm tabular-nums">{odVal}</TableCell>
                      <TableCell className="py-2.5 pr-3 text-sm tabular-nums">{osVal}</TableCell>
                      <TableCell className="py-2.5 text-right">
                        {flaggedStored && (
                          <Flag className="ml-auto h-4 w-4 text-critical-foreground" aria-hidden />
                        )}
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="py-2 pr-3 align-top">
                        <div className="space-y-1.5">
                          {cfg.fields.map((f) => (
                            <ValueInput
                              key={f.key}
                              value={e.od[f.key] ?? ''}
                              unit={f.unit}
                              label={cfg.fields.length > 1 ? f.label : undefined}
                              ariaLabel={`${t('detail.eye.od')} · ${f.label || typeLabel(type, t)}`}
                              disabled={paymentBlocked}
                              onChange={(v) => setValue(type, 'od', f.key, v)}
                            />
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 pr-3 align-top">
                        <div className="space-y-1.5">
                          {cfg.fields.map((f) => (
                            <ValueInput
                              key={f.key}
                              value={e.os[f.key] ?? ''}
                              unit={f.unit}
                              label={cfg.fields.length > 1 ? f.label : undefined}
                              ariaLabel={`${t('detail.eye.os')} · ${f.label || typeLabel(type, t)}`}
                              disabled={paymentBlocked}
                              onChange={(v) => setValue(type, 'os', f.key, v)}
                            />
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 text-right align-top">
                        <button
                          type="button"
                          aria-label={t('detail.flagToggle')}
                          aria-pressed={e.flagged}
                          disabled={paymentBlocked}
                          onClick={() => setFlag(type, !e.flagged)}
                          className={cn(
                            'inline-flex h-11 w-11 items-center justify-center rounded-lg border transition-colors',
                            paymentBlocked && 'cursor-not-allowed opacity-50',
                            e.flagged
                              ? 'border-critical-border bg-critical-bg text-critical-foreground'
                              : 'border-field text-muted-foreground hover:bg-muted',
                          )}
                        >
                          <Flag className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Açıklama + Gönder + Ertele */}
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Flag className="h-3.5 w-3.5 text-critical-foreground" aria-hidden />
            {t('detail.flagHint')}
          </p>
          <div className="flex gap-2">
            {/* R2 (#724) — "Ertele": hazır olmayan talebi (hasta gelmedi/cihaz meşgul)
                sebep ile ertele; aktif kuyruktan çıkar. */}
            <Button variant="outline" onClick={onDefer} disabled={defer.isPending}>
              {t('detail.defer')}
            </Button>
            <Button
              onClick={submit}
              disabled={fulfill.isPending || filledCount === 0 || paymentBlocked}
            >
              {fulfill.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <SendHorizonal className="mr-1.5 h-4 w-4" />
              )}
              {t('detail.send')}
            </Button>
          </div>
        </div>
      )}

      {/* R2 (#724) — Ertelenmiş görünüm: "Geri al" (aktif kuyruğa döndür). */}
      {deferred && (
        <div className="flex items-center justify-end">
          <Button onClick={() => resume.mutate({ orderId: order.id })} disabled={resume.isPending}>
            {resume.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t('detail.resume')}
          </Button>
        </div>
      )}

      {/* #426 — cihaz çıktısı yükleme dialogu; toast PhotoUpload içinde fırlar. */}
      {!readOnly && (
        <PhotoUpload
          open={showDeviceUpload}
          onOpenChange={setShowDeviceUpload}
          patientId={order.patient.id}
          defaultTag="device_output"
          onUploaded={() => setShowDeviceUpload(false)}
        />
      )}
    </div>
  );
}

function ValueInput({
  value,
  unit,
  label,
  ariaLabel,
  disabled,
  onChange,
}: {
  value: string;
  unit?: string;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        className={cn(
          'focus-ring h-11 w-full rounded-lg border border-field bg-background px-3 text-sm tabular-nums hover:border-field-hover',
          label && 'pl-12',
          unit && 'pr-12',
          disabled && 'cursor-not-allowed bg-muted opacity-60',
        )}
      />
      {label && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-muted-foreground">
          {label}
        </span>
      )}
      {unit && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {unit}
        </span>
      )}
    </div>
  );
}
