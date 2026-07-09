import { z } from 'zod';

const optionalPhone = z
  .string()
  .max(20)
  .regex(/^[+0-9 ()-]*$/, 'Geçersiz telefon formatı')
  .optional()
  .or(z.literal(''));

const optionalString = (max: number) => z.string().max(max).optional().or(z.literal(''));

export const doctorFormSchema = z.object({
  name: z.string().min(2, 'Ad soyad en az 2 karakter').max(200),
  specialty: z.string().min(1, 'Uzmanlık zorunlu').max(100),
  type: z.enum(['local', 'visiting', 'referral'], { message: 'Tip seçimi zorunlu' }),
  contactPhone: optionalPhone,
  contactEmail: z.union([z.string().email('Geçerli bir e-posta'), z.literal('')]).optional(),
  // Form keeps commission as a free-text decimal so the user can clear it;
  // toApiPayload converts to the API's "0-100 string" contract.
  commissionRate: z
    .string()
    .regex(/^(\d+(\.\d{1,2})?)?$/, 'Komisyon 0-100 ondalık')
    .optional()
    .or(z.literal('')),
  isActive: z.boolean().default(true),
  notes: optionalString(2000),
});

export type DoctorFormValues = z.infer<typeof doctorFormSchema>;

export const emptyDoctorForm: DoctorFormValues = {
  name: '',
  specialty: '',
  type: 'local',
  contactPhone: '',
  contactEmail: '',
  commissionRate: '',
  isActive: true,
  notes: '',
};

/**
 * Form values → API payload. Empty strings become null so optional/nullable
 * Zod fields on the server validate cleanly.
 */
export function toApiPayload(values: DoctorFormValues) {
  const blankToNull = (v: string | undefined) => (v && v.length > 0 ? v : null);
  return {
    name: values.name,
    specialty: values.specialty,
    type: values.type,
    contactPhone: blankToNull(values.contactPhone),
    contactEmail: blankToNull(values.contactEmail),
    commissionRate: values.commissionRate ? values.commissionRate : null,
    isActive: values.isActive,
    notes: blankToNull(values.notes),
  };
}

export const DOCTOR_TYPES: { value: 'local' | 'visiting' | 'referral'; label: string }[] = [
  { value: 'local', label: 'Klinik personeli' },
  { value: 'visiting', label: 'Misafir doktor' },
  { value: 'referral', label: 'Sevk eden / dışarıdan' },
];

// Common ophthalmology specialties — typeahead suggestions, not a hard list.
export const SPECIALTY_SUGGESTIONS = [
  'Göz Hastalıkları',
  'Retina',
  'Glokom',
  'Pediatrik Oftalmoloji',
  'Refraktif Cerrahi',
  'Kornea',
  'Strabismus',
];

// ---------------------------------------------------------------------------
// Availability schema
// ---------------------------------------------------------------------------

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const availabilitySlotFormSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(HHMM, 'Saat HH:MM olmalı'),
    endTime: z.string().regex(HHMM, 'Saat HH:MM olmalı'),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.startTime < v.endTime, {
    message: 'Bitiş saati başlangıçtan sonra olmalı',
    path: ['endTime'],
  });

export type AvailabilitySlot = z.infer<typeof availabilitySlotFormSchema>;

export const DAYS_OF_WEEK: { value: number; short: string; label: string }[] = [
  { value: 1, short: 'Pzt', label: 'Pazartesi' },
  { value: 2, short: 'Sal', label: 'Salı' },
  { value: 3, short: 'Çar', label: 'Çarşamba' },
  { value: 4, short: 'Per', label: 'Perşembe' },
  { value: 5, short: 'Cum', label: 'Cuma' },
  { value: 6, short: 'Cmt', label: 'Cumartesi' },
  { value: 0, short: 'Paz', label: 'Pazar' },
];
