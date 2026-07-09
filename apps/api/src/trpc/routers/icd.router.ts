import { z } from 'zod';
import { IcdService } from '../../icd/icd.service';
import { protectedProcedure, router } from '../trpc';

const localeSchema = z.enum(['tr', 'ru', 'tg']).default('tr');

export const icdRouterFactory = (icd: IcdService) =>
  router({
    search: protectedProcedure
      .input(
        z.object({
          query: z.string().min(1).max(100),
          locale: localeSchema,
          limit: z.coerce.number().int().min(1).max(50).default(25),
        }),
      )
      .query(({ input }) => icd.search(input.query, input.locale, input.limit)),

    getByCodes: protectedProcedure
      .input(z.object({ codes: z.array(z.string().min(1).max(10)).max(50) }))
      .query(({ input }) => icd.getByCodes(input.codes)),
  });
