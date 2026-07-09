import { z } from 'zod';
import { PurchaseOrderService } from '../../purchase-order/purchase-order.service';
import {
  poCreateSchema,
  poListQuerySchema,
  poReceiveSchema,
  poRejectSchema,
} from '../../purchase-order/purchase-order.schemas';
import { permissionProcedure, router } from '../trpc';

// v0.4 #549 — Satın Alma Siparişi router. Rol yetkileri #542'de tanımlı:
// po.create/submit/receive/cancel = Stok&SatınAlma; po.approve = finans+yönetici
// (görev ayrılığı service-layer'da: oluşturan ≠ onaylayan).
export const purchaseOrderRouterFactory = (purchaseOrders: PurchaseOrderService) =>
  router({
    // #665 — PO listesi/detayı tedarikçi + mali veri içerir; bare protectedProcedure'dı
    // (tenant-içi her kullanıcı okuyabiliyordu). page:purchaseOrders ile gate'lendi.
    list: permissionProcedure('page:purchaseOrders')
      .input(poListQuerySchema)
      .query(({ input }) => purchaseOrders.list(input)),

    byId: permissionProcedure('page:purchaseOrders')
      .input(z.object({ id: z.string().uuid() }))
      .query(({ input }) => purchaseOrders.findById(input.id)),

    // #713 — kalem → stok varlığı bağlama seçenekleri (consumable + eczane ürünü).
    referenceOptions: permissionProcedure('action:po.create').query(() =>
      purchaseOrders.referenceOptions(),
    ),

    create: permissionProcedure('action:po.create')
      .input(poCreateSchema)
      .mutation(({ input, ctx }) =>
        purchaseOrders.create(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    submit: permissionProcedure('action:po.submit')
      .input(z.object({ id: z.string().uuid() }))
      .mutation(({ input }) => purchaseOrders.submit(input.id)),

    approve: permissionProcedure('action:po.approve')
      .input(z.object({ id: z.string().uuid() }))
      .mutation(({ input, ctx }) =>
        purchaseOrders.approve(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    reject: permissionProcedure('action:po.approve')
      .input(poRejectSchema)
      .mutation(({ input, ctx }) =>
        purchaseOrders.reject(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    receive: permissionProcedure('action:po.receive')
      .input(poReceiveSchema)
      .mutation(({ input, ctx }) =>
        purchaseOrders.receive(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    cancel: permissionProcedure('action:po.cancel')
      .input(z.object({ id: z.string().uuid() }))
      .mutation(({ input }) => purchaseOrders.cancel(input.id)),
  });
