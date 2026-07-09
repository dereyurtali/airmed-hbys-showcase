import { z } from 'zod';
import {
  NurseSessionService,
  revokeSessionSchema,
  startSessionSchema,
} from '../../nurse-session/nurse-session.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

const sessionIdInput = z.object({ id: z.string().uuid() });

/**
 * S15-PR10 — Hemşire "Acting on Behalf" tRPC endpoint'leri.
 *
 * Permission'lar:
 *  - start/end: action:nurseSession.manage (hemsire + yonetici + asistan)
 *  - revoke: action:nurseSession.revoke (sadece yonetici)
 *  - my (kendi aktif session'ı): protectedProcedure (rol gözetmez)
 *  - listForDoctor: protectedProcedure (doktor kendi asistanlarını görür)
 */
export const nurseSessionRouterFactory = (svc: NurseSessionService) =>
  router({
    /** Kendi aktif session'ım var mı? UI worklist banner + hemşire sidebar (Dr. X adı). */
    my: protectedProcedure.query(async ({ ctx }) => {
      return svc.getActiveForNurseWithDoctor(ctx.user!.sub);
    }),

    start: permissionProcedure('action:nurseSession.manage')
      .input(startSessionSchema)
      .mutation(({ input, ctx }) => svc.start(input, ctx.user!.sub)),

    end: permissionProcedure('action:nurseSession.manage')
      .input(sessionIdInput)
      .mutation(({ input, ctx }) => svc.end(input.id, ctx.user!.sub)),

    revoke: permissionProcedure('action:nurseSession.revoke')
      .input(revokeSessionSchema)
      .mutation(({ input, ctx }) => svc.revoke(input, ctx.user!.sub)),

    /** Doktorun aktif asistanları (kendi UserId'sinden). */
    myActiveAssistants: protectedProcedure.query(({ ctx }) =>
      svc.listActiveAssistantsForDoctor(ctx.user!.sub),
    ),
  });
