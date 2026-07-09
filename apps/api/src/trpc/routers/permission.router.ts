import {
  matrixReadInputSchema,
  matrixToggleInputSchema,
} from '../../permission/permission.schemas';
import { PermissionMatrixService } from '../../permission/permission.service';
import { permissionProcedure, router } from '../trpc';

// S14 — Permission matrix tRPC router. PermissionsPage UI'sından çağrılır.
// İçeride PermissionAssignment override CRUD; varsayılanlar PERMISSIONS
// registry'sinden.

export const permissionRouterFactory = (permissions: PermissionMatrixService) =>
  router({
    matrix: permissionProcedure('action:permission.matrixRead')
      .input(matrixReadInputSchema)
      .query(({ input }) => permissions.read(input)),

    toggle: permissionProcedure('action:permission.matrixWrite')
      .input(matrixToggleInputSchema)
      .mutation(({ input }) => permissions.toggle(input)),
  });
