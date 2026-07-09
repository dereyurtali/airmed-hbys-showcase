import { z } from 'zod';
import { PharmacyRetailService } from '../../pharmacy-retail/pharmacy-retail.service';
import {
  batchAdjustSchema,
  batchCreateSchema,
  cashCloseSchema,
  cashOpenSchema,
  prescriptionDispenseSchema,
  productCreateSchema,
  productListQuerySchema,
  productUpdateSchema,
  reportQuerySchema,
  returnCreateSchema,
  saleCreateSchema,
  saleListQuerySchema,
} from '../../pharmacy-retail/pharmacy-retail.schemas';
import { permissionProcedure, router } from '../trpc';

// v0.4 #552 — Eczane perakende router. Yetkiler #542'de: page:pharmacy* (görüntü),
// action:pharmacy.sale/return/cashClose/stockAdjust (işlem).
const idInput = z.object({ id: z.string().uuid() });
const actorOf = (ctx: { user?: { sub: string; roles: readonly string[] } }) => ({
  id: ctx.user!.sub,
  roles: ctx.user!.roles,
});

export const pharmacyRetailRouterFactory = (svc: PharmacyRetailService) =>
  router({
    // Katalog + stok
    listProducts: permissionProcedure('page:pharmacyStock')
      .input(productListQuerySchema)
      .query(({ input }) => svc.listProducts(input)),
    createProduct: permissionProcedure('action:pharmacy.stockAdjust')
      .input(productCreateSchema)
      .mutation(({ input }) => svc.createProduct(input)),
    updateProduct: permissionProcedure('action:pharmacy.stockAdjust')
      .input(idInput.extend({ data: productUpdateSchema }))
      .mutation(({ input }) => svc.updateProduct(input.id, input.data)),
    softDeleteProduct: permissionProcedure('action:pharmacy.stockAdjust')
      .input(idInput)
      .mutation(({ input }) => svc.softDeleteProduct(input.id)),
    createBatch: permissionProcedure('action:pharmacy.stockAdjust')
      .input(batchCreateSchema)
      .mutation(({ input, ctx }) => svc.createBatch(input, actorOf(ctx))),
    adjustBatch: permissionProcedure('action:pharmacy.stockAdjust')
      .input(batchAdjustSchema)
      .mutation(({ input, ctx }) => svc.adjustBatch(input, actorOf(ctx))),

    // POS satış
    createSale: permissionProcedure('action:pharmacy.sale')
      .input(saleCreateSchema)
      .mutation(({ input, ctx }) => svc.createSale(input, actorOf(ctx))),
    listSales: permissionProcedure('page:pharmacyPos')
      .input(saleListQuerySchema)
      .query(({ input }) => svc.listSales(input)),
    saleById: permissionProcedure('page:pharmacyPos')
      .input(idInput)
      .query(({ input }) => svc.findSaleById(input.id)),

    // İade
    createReturn: permissionProcedure('action:pharmacy.return')
      .input(returnCreateSchema)
      .mutation(({ input, ctx }) => svc.createReturn(input, actorOf(ctx))),
    listReturns: permissionProcedure('page:pharmacyReturns')
      .input(saleListQuerySchema)
      .query(({ input }) => svc.listReturns(input)),

    // Kasa
    openCash: permissionProcedure('action:pharmacy.cashClose')
      .input(cashOpenSchema)
      .mutation(({ input, ctx }) => svc.openCash(input, actorOf(ctx))),
    closeCash: permissionProcedure('action:pharmacy.cashClose')
      .input(cashCloseSchema)
      .mutation(({ input, ctx }) => svc.closeCash(input, actorOf(ctx))),
    handToFinance: permissionProcedure('action:pharmacy.cashClose')
      .input(idInput)
      .mutation(({ input, ctx }) => svc.handToFinance(input.id, actorOf(ctx))),
    // #664 — 2-aşama: finans mutabakatı (eczacının cashClose'undan ayrı yetki).
    reconcileCash: permissionProcedure('action:pharmacy.cashReconcile')
      .input(idInput)
      .mutation(({ input, ctx }) => svc.reconcileCash(input.id, actorOf(ctx))),
    currentCash: permissionProcedure('page:pharmacyCash').query(() => svc.currentCash()),
    listCash: permissionProcedure('page:pharmacyCash')
      .input(saleListQuerySchema)
      .query(({ input }) => svc.listCash(input)),

    // v0.4.1 (#692) — eczane stok hareketleri (Mal Kabul / Stok Hareketleri).
    recentMovements: permissionProcedure('page:pharmacyStock')
      .input(z.object({ limit: z.number().int().min(1).max(500).optional() }))
      .query(({ input }) => svc.recentMovements(input.limit ?? 100)),

    // v0.4.1 (#693) — Eczane Tedarikçileri (partilerden türetilmiş).
    suppliers: permissionProcedure('page:pharmacyStock').query(() => svc.pharmacySuppliers()),

    // Rapor + reçete köprüsü
    salesReport: permissionProcedure('page:pharmacyReports')
      .input(reportQuerySchema)
      .query(({ input }) => svc.salesReport(input)),
    dispensablePrescriptions: permissionProcedure('page:pharmacyPrescriptions').query(() =>
      svc.listDispensablePrescriptions(),
    ),
    // #790 — eczacı reçeteyi dağıttıkça durumu işaretler (kısmi/tam).
    markPrescriptionDispense: permissionProcedure('action:pharmacy.sale')
      .input(prescriptionDispenseSchema)
      .mutation(({ input }) => svc.markPrescriptionDispense(input.id, input.status)),
  });
