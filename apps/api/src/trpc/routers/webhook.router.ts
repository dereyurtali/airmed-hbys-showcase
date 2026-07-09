import {
  webhookCreateSchema,
  webhookDeliveryListQuerySchema,
  webhookIdSchema,
  webhookTestFireSchema,
  webhookUpdateSchema,
} from '../../webhook/webhook.schemas';
import { WebhookService } from '../../webhook/webhook.service';
import { permissionProcedure, router } from '../trpc';

// S14 — Webhook admin tRPC router. Tüm rotalar 'yonetici' rolüne kısıtlı
// (api key paritesi — anahtarın bir parçası gibi dış sistemlere veri sızıyor).

export const webhookRouterFactory = (webhooks: WebhookService) =>
  router({
    list: permissionProcedure('action:webhook.list').query(({ ctx }) =>
      webhooks.list({ id: ctx.user!.sub, roles: ctx.user!.roles }),
    ),

    findOne: permissionProcedure('action:webhook.list')
      .input(webhookIdSchema)
      .query(({ input, ctx }) =>
        webhooks.findById(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    create: permissionProcedure('action:webhook.create')
      .input(webhookCreateSchema)
      .mutation(({ input, ctx }) =>
        webhooks.create(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    update: permissionProcedure('action:webhook.update')
      .input(webhookIdSchema.extend({ data: webhookUpdateSchema }))
      .mutation(({ input, ctx }) =>
        webhooks.update(input.id, input.data, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    remove: permissionProcedure('action:webhook.revoke')
      .input(webhookIdSchema)
      .mutation(({ input, ctx }) =>
        webhooks.remove(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    testFire: permissionProcedure('action:webhook.create')
      .input(webhookTestFireSchema)
      .mutation(({ input, ctx }) =>
        webhooks.testFire(input.id, input.event, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    listDeliveries: permissionProcedure('action:webhook.list')
      .input(webhookDeliveryListQuerySchema)
      .query(({ input, ctx }) =>
        webhooks.listDeliveries(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),
  });
