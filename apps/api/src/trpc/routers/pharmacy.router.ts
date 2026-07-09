import { z } from 'zod';
import {
  checkInteractionsSchema,
  DrugInteractionService,
} from '../../pharmacy/drug-interaction.service';
import {
  prescriptionCreateSchema,
  prescriptionIdSchema,
  prescriptionListQuerySchema,
  prescriptionUpdateSchema,
  supplierCreateSchema,
  supplierListQuerySchema,
  supplierUpdateSchema,
} from '../../pharmacy/pharmacy.schemas';
import { PharmacyService } from '../../pharmacy/pharmacy.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

const idInput = z.object({ id: z.string().uuid() });

// S10b — Tedarikçi CRUD admin'e bağlı; reçete doktor + softDelete yönetici/doktor.
// S15-PR4 — Drug interaction checker; reçete create öncesi UI'dan tetiklenir.
export const pharmacyRouterFactory = (
  pharmacy: PharmacyService,
  drugInteractions: DrugInteractionService,
) =>
  router({
    // S15-PR4 — İlaç etkileşim kontrolü (DB-less, in-memory katalog lookup).
    checkInteractions: protectedProcedure
      .input(checkInteractionsSchema)
      .query(({ input }) => drugInteractions.check(input)),

    // Suppliers
    listSuppliers: protectedProcedure
      .input(supplierListQuerySchema)
      .query(({ input }) => pharmacy.listSuppliers(input)),

    findSupplierById: protectedProcedure
      .input(idInput)
      .query(({ input }) => pharmacy.findSupplierById(input.id)),

    createSupplier: permissionProcedure('action:supplier.create')
      .input(supplierCreateSchema)
      .mutation(({ input, ctx }) =>
        pharmacy.createSupplier(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    updateSupplier: permissionProcedure('action:supplier.update')
      .input(idInput.extend({ data: supplierUpdateSchema }))
      .mutation(({ input, ctx }) =>
        pharmacy.updateSupplier(input.id, input.data, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    softDeleteSupplier: permissionProcedure('action:supplier.softDelete')
      .input(idInput)
      .mutation(async ({ input, ctx }) => {
        await pharmacy.softDeleteSupplier(input.id, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        });
        return { ok: true as const };
      }),

    // Prescriptions
    listPrescriptions: protectedProcedure
      .input(prescriptionListQuerySchema)
      .query(({ input }) => pharmacy.listPrescriptions(input)),

    findPrescriptionById: protectedProcedure
      .input(prescriptionIdSchema)
      .query(({ input }) => pharmacy.findPrescriptionById(input.id)),

    createPrescription: permissionProcedure('action:prescription.create')
      .input(prescriptionCreateSchema)
      .mutation(({ input, ctx }) =>
        pharmacy.createPrescription(input, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    updatePrescription: permissionProcedure('action:prescription.update')
      .input(prescriptionIdSchema.extend({ data: prescriptionUpdateSchema }))
      .mutation(({ input, ctx }) =>
        pharmacy.updatePrescription(input.id, input.data, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    softDeletePrescription: permissionProcedure('action:prescription.softDelete')
      .input(prescriptionIdSchema)
      .mutation(async ({ input, ctx }) => {
        await pharmacy.softDeletePrescription(input.id, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        });
        return { ok: true as const };
      }),

    sendPrescription: permissionProcedure('action:prescription.send')
      .input(prescriptionIdSchema)
      .mutation(({ input, ctx }) =>
        pharmacy.sendPrescription(input.id, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    // #712 — Reçeteyi İÇ eczane POS kuyruğuna gönder (dış tedarikçi siparişinden
    // ayrı sinyal). Aynı "send" yetkisi (prescriber/yönetici).
    dispenseToPharmacy: permissionProcedure('action:prescription.send')
      .input(prescriptionIdSchema)
      .mutation(({ input, ctx }) =>
        pharmacy.dispenseToPharmacy(input.id, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),
  });
