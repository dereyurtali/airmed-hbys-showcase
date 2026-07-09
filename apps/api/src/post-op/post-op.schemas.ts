import { z } from 'zod';

// B4 Post-op takip — Zod şemaları.
//
// Yeni DB modeli yok: post-op takip randevuları mevcut A6 Appointment tablosu
// üzerinde `type='control'` (ameliyat sonrası = kontrol randevusu; ayrı 'post_op'
// tipi ÜRETİLMEZ). Normal kontrolden `notes` alanındaki surgery referansı
// (`#surgery:<uuid>`) ile ayrılır; listFollowUps + recall bununla bulur.

export const SURGERY_REF_TAG = '#surgery:';

const isoDateTime = z.string().datetime({ offset: true });

export const followUpProposalSchema = z.object({
  daysFromSurgery: z.coerce.number().int().min(1).max(365),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  notes: z.string().max(500).optional().nullable(),
});

export const scheduleFollowUpsSchema = z.object({
  surgeryId: z.string().uuid(),
  proposals: z.array(followUpProposalSchema).min(1).max(6),
});

export const surgeryIdSchema = z.object({ surgeryId: z.string().uuid() });

export const complicationsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export type FollowUpProposal = z.infer<typeof followUpProposalSchema>;
export type ScheduleFollowUpsInput = z.infer<typeof scheduleFollowUpsSchema>;
export type ComplicationsQuery = z.infer<typeof complicationsQuerySchema>;
