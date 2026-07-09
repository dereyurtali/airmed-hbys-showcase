import { z } from 'zod';
import { apiKeyCreateSchema, apiKeyUpdateSchema } from '../../api-key/api-key.schemas';
import { ApiKeyService } from '../../api-key/api-key.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

const idInput = z.object({ id: z.string().uuid() });

export const apiKeyRouterFactory = (apiKeys: ApiKeyService) =>
  router({
    list: protectedProcedure.query(({ ctx }) =>
      apiKeys.list({ id: ctx.user!.sub, roles: ctx.user!.roles }),
    ),

    findById: protectedProcedure
      .input(idInput)
      .query(({ input, ctx }) =>
        apiKeys.findById(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    // S3 — permissionProcedure: sensitiveProcedure'ın evrimi. Permission key
    // ile spesifik izin kontrolü (apiKey.* sadece yönetici — Karar 4) +
    // impersonation block (zaten sensitiveProcedure'dan miras).
    create: permissionProcedure('action:apiKey.create')
      .input(apiKeyCreateSchema)
      .mutation(({ input, ctx }) =>
        apiKeys.create(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    update: permissionProcedure('action:apiKey.update')
      .input(idInput.extend({ data: apiKeyUpdateSchema }))
      .mutation(({ input, ctx }) =>
        apiKeys.update(input.id, input.data, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    revoke: permissionProcedure('action:apiKey.revoke')
      .input(idInput)
      .mutation(({ input, ctx }) =>
        apiKeys.revoke(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    rotate: permissionProcedure('action:apiKey.rotate')
      .input(idInput)
      .mutation(({ input, ctx }) =>
        apiKeys.rotate(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),
  });
