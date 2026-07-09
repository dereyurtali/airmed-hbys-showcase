// A6 randevu — frontend constants.
//
// Backend kaynaklar (bire bir uyum gerekir):
// - APPOINTMENT_TYPES, APPOINTMENT_STATUSES → apps/api/src/appointment/appointment.schemas.ts
// - LEGAL_TRANSITIONS → apps/api/src/appointment/appointment.service.ts
//
// Backend'den runtime import etmiyoruz çünkü web bundle'ı api package'ı
// import etmesin (sadece type import yoluyla AppRouter görür). 8 type ×
// 6 status değişimi nadirdir; eşitliği test ile değil, kod review ile koruyoruz.

import {
  Activity,
  CheckCircle,
  ClipboardList,
  Microscope,
  Scissors,
  Syringe,
  User,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ServiceCategory } from './billing.constants';

export const APPOINTMENT_TYPES = [
  'consultation',
  'surgery',
  'control',
  'injection',
  'laser',
  'examination',
  'pre_op',
  'post_op',
] as const;

export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

// Manuel randevu olarak açılmaz: tetkik → muayene/kontrol zaten kapsar;
// pre_op/post_op ameliyat & recall modülleri tarafından otomatik üretilir.
// Enum'da kalır (mevcut randevular render/filtre edilsin), sadece tip
// seçicisinden (oluştur + düzenle) gizlenir.
const NON_CREATABLE_TYPES = new Set<AppointmentType>(['examination', 'pre_op', 'post_op']);

export const CREATABLE_APPOINTMENT_TYPES = APPOINTMENT_TYPES.filter(
  (t) => !NON_CREATABLE_TYPES.has(t),
); // → [consultation, surgery, control, injection, laser]

export function isCreatableAppointmentType(t: AppointmentType): boolean {
  return !NON_CREATABLE_TYPES.has(t);
}

// Check-in'de ölçüm-varsayılan tipler: muayene/kontrol (+ oto-üretilen takipler
// examination/pre_op/post_op). Backend aynası: appointment.schemas.ts
// CHECKIN_STATION_BY_TYPE. Bu tiplerde resepsiyon "Geldi"yi varsayılan ölçüme
// gönderir, opsiyonel "Doktora" override sunulur. Girişimsel tipler
// (surgery/injection/laser) zaten doğrudan doktora gider.
const CHECKIN_MEASUREMENT_DEFAULT_TYPES = new Set<AppointmentType>([
  'consultation',
  'control',
  'examination',
  'pre_op',
  'post_op',
]);

export function isMeasurementDefaultCheckin(t: AppointmentType): boolean {
  return CHECKIN_MEASUREMENT_DEFAULT_TYPES.has(t);
}

// v0.4.2 Karar 4 (#725) — randevu tipi → giriş ücreti ServiceItem kategorisi.
// Resepsiyon "Geldi + Tahsilat" akışında faturaya bu kategorinin "tek default"
// kalemi (pickDefaultServiceItem) otomatik gelir; resepsiyon düzenleyebilir.
// null = otomatik kalem yok (resepsiyon elle girer): cerrahi faturası ameliyat_satış'a
// aittir, pre_op/post_op kalemleri ayrı akışta. Kategoride aktif kalem yoksa prefill sessizce atlanır.
const SERVICE_CATEGORY_BY_APPOINTMENT_TYPE: Record<AppointmentType, ServiceCategory | null> = {
  consultation: 'examination',
  control: 'examination',
  examination: 'examination',
  injection: 'procedure',
  laser: 'procedure',
  surgery: null,
  pre_op: null,
  post_op: null,
};

export function serviceCategoryForAppointmentType(t: AppointmentType): ServiceCategory | null {
  return SERVICE_CATEGORY_BY_APPOINTMENT_TYPE[t] ?? null;
}

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

// Renk palette spec'in `A6-randevu-takvimi.md` lines 41-49'da kararlaştırıldı.
// Tailwind dynamic class regex'i için tailwind.config.js safelist'ine eklendi.
export interface AppointmentTypeMeta {
  color: string; // text rengi (Tailwind token)
  bg: string; // background rengi
  border: string; // sol kenar accent
  icon: LucideIcon;
  labelKey: string; // i18n: appointment:type.<key>
}

export const APPOINTMENT_TYPE_META: Record<AppointmentType, AppointmentTypeMeta> = {
  consultation: {
    color: 'text-sky-700',
    bg: 'bg-sky-100',
    border: 'border-sky-700',
    icon: User,
    labelKey: 'type.consultation',
  },
  control: {
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
    border: 'border-emerald-700',
    icon: CheckCircle,
    labelKey: 'type.control',
  },
  examination: {
    color: 'text-violet-700',
    bg: 'bg-violet-100',
    border: 'border-violet-700',
    icon: Microscope,
    labelKey: 'type.examination',
  },
  surgery: {
    color: 'text-rose-700',
    bg: 'bg-rose-100',
    border: 'border-rose-700',
    icon: Scissors,
    labelKey: 'type.surgery',
  },
  injection: {
    color: 'text-amber-700',
    bg: 'bg-amber-100',
    border: 'border-amber-700',
    icon: Syringe,
    labelKey: 'type.injection',
  },
  laser: {
    color: 'text-fuchsia-700',
    bg: 'bg-fuchsia-100',
    border: 'border-fuchsia-700',
    icon: Zap,
    labelKey: 'type.laser',
  },
  pre_op: {
    color: 'text-orange-700',
    bg: 'bg-orange-100',
    border: 'border-orange-700',
    icon: ClipboardList,
    labelKey: 'type.preOp',
  },
  post_op: {
    color: 'text-teal-700',
    bg: 'bg-teal-100',
    border: 'border-teal-700',
    icon: Activity,
    labelKey: 'type.postOp',
  },
};

export interface AppointmentStatusMeta {
  badge: string; // chip class
  labelKey: string; // i18n: appointment:status.<key>
}

export const APPOINTMENT_STATUS_META: Record<AppointmentStatus, AppointmentStatusMeta> = {
  scheduled: {
    badge: 'bg-slate-100 text-slate-700',
    labelKey: 'status.scheduled',
  },
  checked_in: {
    badge: 'bg-blue-100 text-blue-700',
    labelKey: 'status.checkedIn',
  },
  in_progress: {
    badge: 'bg-indigo-100 text-indigo-700',
    labelKey: 'status.inProgress',
  },
  completed: {
    badge: 'bg-emerald-100 text-emerald-700',
    labelKey: 'status.completed',
  },
  cancelled: {
    badge: 'bg-zinc-100 text-zinc-500',
    labelKey: 'status.cancelled',
  },
  no_show: {
    badge: 'bg-rose-100 text-rose-700',
    labelKey: 'status.noShow',
  },
};

// State machine — backend appointment.service.ts ile bire bir.
// S15: checked_in → in_progress edge artık sürülür (Encounter "Muayeneye başla"
// aksiyonu randevuyu in_progress'e taşır; eskiden atıldı, doğrudan completed'a gidiliyordu).
export const LEGAL_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  scheduled: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_progress', 'completed', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function isLegalTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}
