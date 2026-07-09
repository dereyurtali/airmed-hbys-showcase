import {
  photoByPatientSchema,
  photoIdSchema,
  photoListQuerySchema,
  photoUpdateSchema,
} from '../../photo/photo.schemas';
import { PhotoService } from '../../photo/photo.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// S10b — Foto metadata update doktor/hemşire; softDelete yalnız yönetici.
// Upload REST tarafında ayrı endpoint; bu router metadata/sorgu kapsamı.
export const photoRouterFactory = (photos: PhotoService) =>
  router({
    list: protectedProcedure.input(photoListQuerySchema).query(({ input }) => photos.list(input)),

    listByPatient: protectedProcedure
      .input(photoByPatientSchema)
      .query(({ input }) => photos.listByPatient(input.patientId)),

    findById: protectedProcedure
      .input(photoIdSchema)
      .query(({ input }) => photos.findById(input.id)),

    update: permissionProcedure('action:photo.update')
      .input(photoIdSchema.extend({ data: photoUpdateSchema }))
      .mutation(({ input, ctx }) =>
        photos.update(input.id, input.data, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    softDelete: permissionProcedure('action:photo.delete')
      .input(photoIdSchema)
      .mutation(async ({ input, ctx }) => {
        await photos.softDelete(input.id, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        });
        return { ok: true as const };
      }),
  });
