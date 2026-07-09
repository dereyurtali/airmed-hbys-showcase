import { z } from 'zod';

// #1049 — Personel dökümanı (CV/diploma/sertifika/sözleşme/diğer).
export const STAFF_DOC_TYPES = ['cv', 'diploma', 'sertifika', 'sozlesme', 'diger'] as const;
export type StaffDocTypeValue = (typeof STAFF_DOC_TYPES)[number];

export const staffDocTypeSchema = z.enum(STAFF_DOC_TYPES);

// list: userId VEYA doctorId filtresi (ikisi de opsiyonel — yetkili tümünü
// listeleyebilir; yetkisiz kullanıcı service katmanında kendi kayıtlarına
// daraltılır).
export const staffDocumentListQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
});
export type StaffDocumentListQuery = z.infer<typeof staffDocumentListQuerySchema>;
