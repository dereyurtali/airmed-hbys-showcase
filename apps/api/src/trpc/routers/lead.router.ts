import {
  leadFunnelQuerySchema,
  leadListQuerySchema,
  leadSetSourceSchema,
} from '../../lead/lead.schemas';
import { LeadService } from '../../lead/lead.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// S10b — Lead source güncelle (lead.update perm, resep/admin).
export const leadRouterFactory = (leads: LeadService) =>
  router({
    funnel: protectedProcedure
      .input(leadFunnelQuerySchema)
      .query(({ input }) => leads.funnel(input)),

    list: protectedProcedure.input(leadListQuerySchema).query(({ input }) => leads.list(input)),

    setSource: permissionProcedure('action:lead.update')
      .input(leadSetSourceSchema)
      .mutation(({ input }) => leads.setSource(input)),
  });
