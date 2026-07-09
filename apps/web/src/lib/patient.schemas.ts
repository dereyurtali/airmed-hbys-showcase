import { z } from 'zod';
import { PATIENT_TAGS, type PatientTag } from './patient-tags.constants';

const optionalPhone = z
  .string()
  .max(20)
  .regex(/^[+0-9 ()-]*$/, 'Geçersiz telefon formatı')
  .optional()
  .or(z.literal(''));

// Hasta birincil telefonu zorunlu (en az 1 rakam içermeli, format izinli karakterler).
// Backend `phone` şemasıyla aynı regex (apps/api/src/patient/patient.schemas.ts).
const requiredPhone = z
  .string()
  .min(4, 'Telefon zorunlu (en az 4 hane)')
  .max(20, 'Telefon en fazla 20 karakter')
  .regex(/^(?=[^0-9]*\d)[+0-9 ()-]+$/, 'Geçerli bir telefon girin');

const optionalString = (max: number) => z.string().max(max).optional().or(z.literal(''));

export const LEAD_SOURCES = [
  'instagram',
  'telegram',
  'whatsapp',
  'doctor_referral',
  'returning_patient',
  'optic_partner',
  'corporate_contract',
  'field_rep',
  'walk_in',
  'second_opinion',
  'other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

// S15-PR1 — Backend mirror; apps/api/src/patient/patient.schemas.ts ile aynı sıra.
export const BLOOD_TYPES = [
  'a_pos',
  'a_neg',
  'b_pos',
  'b_neg',
  'ab_pos',
  'ab_neg',
  'o_pos',
  'o_neg',
  'unknown',
] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];

export const GUARDIAN_RELATIONSHIPS = [
  'mother',
  'father',
  'legal_guardian',
  'grandparent',
  'sibling',
  'other',
] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export const patientFormSchema = z.object({
  firstName: z.string().min(1, 'Ad zorunlu').max(100),
  lastName: z.string().min(1, 'Soyad zorunlu').max(100),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Doğum tarihi YYYY-AA-GG'),
  gender: z.enum(['male', 'female', 'other'], { message: 'Cinsiyet seçimi zorunlu' }),
  phone: requiredPhone,
  identityNo: optionalString(50),
  passportNo: optionalString(50),
  email: z.union([z.string().email('Geçerli bir e-posta'), z.literal('')]).optional(),
  address: optionalString(2000),
  emergencyContactName: optionalString(200),
  emergencyContactPhone: optionalPhone,
  notes: optionalString(2000),
  leadSource: z.union([z.enum(LEAD_SOURCES), z.literal('')]).optional(),
  leadSourceNote: optionalString(255),
  tags: z.array(z.enum(PATIENT_TAGS)).max(15).default([]),
  // S8 — Birincil doktor manuel atama (karar tutanağı §7 hibrit). Resepsiyon
  // yeni hasta eklerken seçer; backend assignManual çağırır. Boş string'i
  // toApiPayload null'a çevirir (backend opsiyonel).
  primaryDoctorId: z.string().uuid('Geçersiz doktor seçimi').or(z.literal('')).optional(),
  // S15-PR1 — Tıbbi alanlar (form local state'i; API'ye dönüşürken null/array boş).
  allergies: z.array(z.string().min(1).max(100)).max(30).default([]),
  anticoagulantMedications: z.array(z.string().min(1).max(100)).max(30).default([]),
  bloodType: z.union([z.enum(BLOOD_TYPES), z.literal('')]).optional(),
  // S15-PR1 — Pediatrik veli (PR7'de yaş <18 ise UI tarafından zorunlu).
  pediatricGuardianName: optionalString(200),
  pediatricGuardianPhone: optionalPhone,
  pediatricGuardianRelationship: z
    .union([z.enum(GUARDIAN_RELATIONSHIPS), z.literal('')])
    .optional(),
});

export type PatientFormValues = z.infer<typeof patientFormSchema>;

export const emptyPatientForm: PatientFormValues = {
  firstName: '',
  lastName: '',
  birthDate: '',
  gender: 'female',
  phone: '',
  identityNo: '',
  passportNo: '',
  email: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  notes: '',
  leadSource: '',
  leadSourceNote: '',
  tags: [],
  primaryDoctorId: '',
  // S15-PR1
  allergies: [],
  anticoagulantMedications: [],
  bloodType: '',
  pediatricGuardianName: '',
  pediatricGuardianPhone: '',
  pediatricGuardianRelationship: '',
};

/**
 * Strip empty strings → null so backend Zod (which expects nullable optional)
 * accepts the payload. Required fields stay as-is.
 */
export function toApiPayload(values: PatientFormValues) {
  const nullify = (v: string | undefined) => (v && v.length > 0 ? v : null);
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    birthDate: values.birthDate,
    gender: values.gender,
    phone: values.phone,
    identityNo: nullify(values.identityNo),
    passportNo: nullify(values.passportNo),
    email: nullify(values.email),
    address: nullify(values.address),
    emergencyContactName: nullify(values.emergencyContactName),
    emergencyContactPhone: nullify(values.emergencyContactPhone),
    notes: nullify(values.notes),
    leadSource: values.leadSource && values.leadSource.length > 0 ? values.leadSource : null,
    leadSourceNote: nullify(values.leadSourceNote),
    tags: (values.tags ?? []) as PatientTag[],
    primaryDoctorId:
      values.primaryDoctorId && values.primaryDoctorId.length > 0 ? values.primaryDoctorId : null,
    // S15-PR1 — Tıbbi alanlar (boş array tutulur, backend default []'i kabul eder).
    allergies: (values.allergies ?? []).filter((s) => s.trim().length > 0),
    anticoagulantMedications: (values.anticoagulantMedications ?? []).filter(
      (s) => s.trim().length > 0,
    ),
    bloodType: values.bloodType && values.bloodType.length > 0 ? values.bloodType : null,
    pediatricGuardianName: nullify(values.pediatricGuardianName),
    pediatricGuardianPhone: nullify(values.pediatricGuardianPhone),
    pediatricGuardianRelationship:
      values.pediatricGuardianRelationship && values.pediatricGuardianRelationship.length > 0
        ? values.pediatricGuardianRelationship
        : null,
  };
}
