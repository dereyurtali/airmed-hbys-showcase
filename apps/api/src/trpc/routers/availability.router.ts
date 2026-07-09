import { freeSlotsQuerySchema } from '../../appointment/availability.schemas';
import { AvailabilityService } from '../../appointment/availability.service';
import { protectedProcedure, router } from '../trpc';

// #1019 — Boş-slot sorgusu (takvim UI + AI hasta asistanı tool'u). Salt-okuma;
// RLS scope yeterli, appointment query'leriyle aynı gerekçeyle protectedProcedure.
export const availabilityRouterFactory = (availability: AvailabilityService) =>
  router({
    freeSlots: protectedProcedure
      .input(freeSlotsQuerySchema)
      .query(({ input }) => availability.freeSlots(input)),
  });
