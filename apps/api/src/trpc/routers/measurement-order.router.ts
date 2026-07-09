import { z } from 'zod';
import {
  measurementOrderCreateSchema,
  measurementOrderDeferSchema,
  measurementOrderFulfillSchema,
  measurementOrderListQuerySchema,
} from '../../measurement/measurement-order.schemas';
import { MeasurementOrderService } from '../../measurement/measurement-order.service';
import { NurseSessionService } from '../../nurse-session/nurse-session.service';
import { permissionProcedure, router } from '../trpc';

// S15c — Ölçüm sipariş akışı. createOrder doktor; fulfill hemşire/doktor;
// listForUnit ölçüm birimi + doktor + admin.
// Karar 3 (#724) — ölçüm talebi oluşturma yalnız doktor (action:measurementOrder
// .create = [DOKTOR]); hemşire (asistan dahil) talep ETMEZ, yalnız fulfill eder.
export const measurementOrderRouterFactory = (
  orders: MeasurementOrderService,
  _nurseSessions: NurseSessionService,
) =>
  router({
    create: permissionProcedure('action:measurementOrder.create')
      .input(measurementOrderCreateSchema)
      .mutation(({ input, ctx }) =>
        // Yalnız doktor bu permission'a sahip → acting-doctor çözümüne gerek yok.
        orders.createOrder(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    fulfill: permissionProcedure('action:measurementOrder.fulfill')
      .input(measurementOrderFulfillSchema)
      .mutation(({ input, ctx }) =>
        orders.fulfill(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    // R2 (#724) — "Resepsiyona bildir": ödeme-bekleyen talepte hemşire resepsiyonu
    // yeniden uyarır (hasta odada, tahsilat yapılmadı).
    notifyPayment: permissionProcedure('action:measurementOrder.fulfill')
      .input(z.object({ orderId: z.string().uuid() }))
      .mutation(({ input }) => orders.notifyReceptionForPayment(input.orderId)),

    // R2 (#724) — "Ertele/Skip": aktif talebi ertele (sebep zorunlu → audit + not).
    defer: permissionProcedure('action:measurementOrder.fulfill')
      .input(measurementOrderDeferSchema)
      .mutation(({ input }) => orders.defer(input)),

    // R2 (#724) — Ertelenmiş talebi geri al (aktif kuyruğa döner).
    resume: permissionProcedure('action:measurementOrder.fulfill')
      .input(z.object({ orderId: z.string().uuid() }))
      .mutation(({ input }) => orders.resume(input.orderId)),

    listForUnit: permissionProcedure('action:measurementOrder.list')
      .input(measurementOrderListQuerySchema)
      .query(({ input }) => orders.listForUnit(input)),
  });
