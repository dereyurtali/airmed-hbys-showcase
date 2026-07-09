import { z } from 'zod';

// C2 Consent — Zod şemaları.
//
// İki ana akış:
//   - Şablon CRUD (sadece yönetici): procedureType + language başına bir aktif
//     sürüm tutulur. Yeni içerik = yeni version (eskileri inactive olur servis
//     tarafında).
//   - İmza (yetki: yonetici / yonetici_asistani / doktor / hemsire): hastanın
//     ekran imzasını base64 PNG olarak alır, şablon içeriğini snapshot eder.

export const CONSENT_PROCEDURE_TYPES = [
  'cataract',
  'retina',
  'laser',
  'intravitreal',
  'refractive',
  'general',
] as const;
export const consentProcedureTypeSchema = z.enum(CONSENT_PROCEDURE_TYPES);
export type ConsentProcedureType = (typeof CONSENT_PROCEDURE_TYPES)[number];

export const CONSENT_LANGUAGES = ['tr', 'ru', 'tg'] as const;
export const consentLanguageSchema = z.enum(CONSENT_LANGUAGES);
export type ConsentLanguage = (typeof CONSENT_LANGUAGES)[number];

// Base64 PNG data URL veya saf base64 — frontend HTML canvas.toDataURL()
// üretir, "data:image/png;base64,..." formatı bekliyoruz. 2MB civarı (≈2.7M b64).
const signatureSchema = z
  .string()
  .min(50, 'Signature data too short — did the user actually sign?')
  .max(4_000_000, 'Signature data exceeds 4MB');

export const consentTemplateCreateSchema = z.object({
  procedureType: consentProcedureTypeSchema,
  language: consentLanguageSchema,
  title: z.string().trim().min(1).max(200),
  content: z.string().min(10).max(50_000),
});

export const consentTemplateUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().min(10).max(50_000).optional(),
  isActive: z.boolean().optional(),
});

export const consentTemplateListSchema = z.object({
  procedureType: consentProcedureTypeSchema.optional(),
  language: consentLanguageSchema.optional(),
  includeInactive: z.boolean().default(false),
});

export const consentTemplateIdSchema = z.object({
  id: z.string().uuid(),
});

export const consentSignSchema = z.object({
  templateId: z.string().uuid(),
  patientId: z.string().uuid(),
  surgeryId: z.string().uuid().optional(),
  signatureData: signatureSchema,
  witnessName: z.string().trim().min(1).max(200).optional(),
  // S15-PR7 — Pediatrik veli onam: hasta yaş <18 ise service-layer guard
  // signedByGuardian=true zorunlu + guardianName/guardianRelationship dolu.
  // ConsentSignDialog UI'da hasta yaşına göre veli mode otomatik tetiklenir.
  signedByGuardian: z.boolean().default(false),
  guardianName: z.string().trim().min(1).max(200).optional(),
  guardianRelationship: z
    .enum(['mother', 'father', 'legal_guardian', 'grandparent', 'sibling', 'other'])
    .optional(),
  guardianIdentityNo: z.string().trim().min(1).max(50).optional(),
});

export const consentRevokeSchema = z.object({
  signingId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export const consentListByPatientSchema = z.object({
  patientId: z.string().uuid(),
  includeRevoked: z.boolean().default(false),
});

export const consentSigningIdSchema = z.object({ signingId: z.string().uuid() });

export type ConsentTemplateCreateInput = z.infer<typeof consentTemplateCreateSchema>;
export type ConsentTemplateUpdateInput = z.infer<typeof consentTemplateUpdateSchema>;
export type ConsentTemplateListQuery = z.infer<typeof consentTemplateListSchema>;
export type ConsentSignInput = z.infer<typeof consentSignSchema>;
export type ConsentRevokeInput = z.infer<typeof consentRevokeSchema>;
