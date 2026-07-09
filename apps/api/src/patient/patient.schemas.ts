import { z } from 'zod';

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

export const leadSourceSchema = z.enum(LEAD_SOURCES);

export const PATIENT_TAGS = [
  'vip',
  'risk_high',
  'risk_low',
  'follow_up',
  'chronic',
  'no_show_risk',
  'insurance',
  'pediatric',
  'geriatric',
] as const;

export const patientTagSchema = z.enum(PATIENT_TAGS);
export type PatientTag = z.infer<typeof patientTagSchema>;

// S15-PR1 — Kan grubu enum'u (Prisma BloodType ile aynı sıra). DB'de snake_case
// (a_pos / a_neg / ...) tutulur; UI label'larını i18n çevirir.
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
export const bloodTypeSchema = z.enum(BLOOD_TYPES);
export type BloodType = z.infer<typeof bloodTypeSchema>;

// S15-PR1 — Pediatrik veli ilişki tipi (Prisma GuardianRelationship ile aynı).
export const GUARDIAN_RELATIONSHIPS = [
  'mother',
  'father',
  'legal_guardian',
  'grandparent',
  'sibling',
  'other',
] as const;
export const guardianRelationshipSchema = z.enum(GUARDIAN_RELATIONSHIPS);
export type GuardianRelationship = z.infer<typeof guardianRelationshipSchema>;

// S15-PR1 — Tıbbi serbest text array (allerji/antikoagülan). 1-100 char/eleman,
// max 30 eleman; XSS/HTML kaçırma için <>& yasak. PR4 ilaç etkileşim DB'sinde
// string match ile karşılaştırılacak (canonicalize edilmemiş).
const medicalTermArray = z
  .array(
    z
      .string()
      .min(1)
      .max(100)
      .regex(/^[^<>&]+$/, 'Geçersiz karakter (<, >, & yasak)'),
  )
  .max(30);

const phone = z
  .string()
  .min(4)
  .max(20)
  // Require at least one digit; "++++" or "----" would otherwise pass
  // and produce an empty phoneLast4.
  .regex(/^(?=[^0-9]*\d)[+0-9 ()-]+$/, 'Phone must contain digits and only +, spaces, parens');

export const patientCreateSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate must be YYYY-MM-DD'),
  gender: z.enum(['male', 'female', 'other']),
  identityNo: z.string().max(50).optional().nullable(),
  passportNo: z.string().max(50).optional().nullable(),
  phone: phone,
  email: z.string().email().max(255).optional().nullable(),
  address: z.string().max(2000).optional().nullable(),
  emergencyContactName: z.string().max(200).optional().nullable(),
  emergencyContactPhone: phone.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  leadSource: leadSourceSchema.optional().nullable(),
  leadSourceNote: z.string().max(255).optional().nullable(),
  tags: z.array(patientTagSchema).max(15).optional(),
  // S4 — Karar tutanağı §7 (hibrit atama). Resepsiyon yeni hasta eklerken
  // primary doctor seçebilir; PatientService.create -> PatientDoctor.upsert
  // (source='manual', isPrimary=true). Yöntem isteğe bağlı — hasta hiç doktora
  // atanmadan da eklenebilir (sonraki randevu açılışında auto upsert).
  primaryDoctorId: z.string().uuid().optional().nullable(),
  // S15-PR1 — Tıbbi alanlar. allergies/anticoagulantMedications boş array
  // default; UI chips ile gösterilir. bloodType varsa pre-op vital'de gözükür.
  allergies: medicalTermArray.optional(),
  anticoagulantMedications: medicalTermArray.optional(),
  bloodType: bloodTypeSchema.optional().nullable(),
  // S15-PR1 — Pediatrik veli alanları. PR7 ConsentSigning'de yaş <18 ise
  // veli zorunlu; service-layer guard PR7'de eklenir, schema burada hazırlanır.
  pediatricGuardianName: z.string().max(200).optional().nullable(),
  pediatricGuardianPhone: z.string().max(20).optional().nullable(),
  pediatricGuardianRelationship: guardianRelationshipSchema.optional().nullable(),
});

export const patientUpdateSchema = patientCreateSchema.partial();

export const patientListQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  tags: z.array(patientTagSchema).max(15).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const patientSetTagsSchema = z.object({
  id: z.string().uuid(),
  tags: z.array(patientTagSchema).max(15),
});

export type PatientSetTagsInput = z.infer<typeof patientSetTagsSchema>;

export const patientDuplicatesSchema = patientCreateSchema.pick({
  firstName: true,
  lastName: true,
  birthDate: true,
  phone: true,
});

export type PatientCreateInput = z.infer<typeof patientCreateSchema>;
export type PatientUpdateInput = z.infer<typeof patientUpdateSchema>;
export type PatientListQuery = z.infer<typeof patientListQuerySchema>;
export type PatientDuplicatesInput = z.infer<typeof patientDuplicatesSchema>;
