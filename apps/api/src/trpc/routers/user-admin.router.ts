import { UsersService } from '../../users/users.service';
import {
  userCreateSchema,
  userIdSchema,
  userListQuerySchema,
  userUpdateModesSchema,
  userUpdateSchema,
} from '../../users/users.schemas';
import { permissionProcedure, router } from '../trpc';

// S17 — Klinik içi kullanıcı yönetimi (yönetici-only). Yönetici bu router üzerinden
// diğer personel hesaplarını ekler/düzenler/şifre sıfırlar/pasifleştirir.
// Tüm endpoint'ler `permissionProcedure` ile yönetici yetkisi şartı altında;
// impersonation altında bile çağrılabilir mi? sensitiveProcedure üst kademesi
// engelliyor (DNA platform admin'in impersonate-edip klinik personeli oynayamaması).
export const userAdminRouterFactory = (users: UsersService) =>
  router({
    list: permissionProcedure('action:user.list')
      .input(userListQuerySchema)
      .query(({ input }) => users.list(input)),

    get: permissionProcedure('action:user.list')
      .input(userIdSchema)
      .query(({ input }) => users.getById(input.id)),

    create: permissionProcedure('action:user.create')
      .input(userCreateSchema)
      .mutation(({ input, ctx }) =>
        users.create(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    update: permissionProcedure('action:user.update')
      .input(userUpdateSchema)
      .mutation(({ input, ctx }) =>
        users.update(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    // #1050 — hemşire mod adayları (flags.modes). Rol kontrolü + merge-patch
    // service katmanında; gate mevcut user mutasyonlarıyla aynı (yönetici).
    updateModes: permissionProcedure('action:user.update')
      .input(userUpdateModesSchema)
      .mutation(({ input, ctx }) =>
        users.updateModes(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    resetPassword: permissionProcedure('action:user.resetPassword')
      .input(userIdSchema)
      .mutation(({ input, ctx }) =>
        users.resetPassword(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    deactivate: permissionProcedure('action:user.deactivate')
      .input(userIdSchema)
      .mutation(({ input, ctx }) =>
        users.deactivate(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    reactivate: permissionProcedure('action:user.deactivate')
      .input(userIdSchema)
      .mutation(({ input, ctx }) =>
        users.reactivate(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),
  });
