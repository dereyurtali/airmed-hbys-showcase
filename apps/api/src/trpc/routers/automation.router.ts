import { z } from 'zod';
import { AutomationAdminService } from '../../automation/automation-admin.service';
import {
  agentActionListQuerySchema,
  agentConfigUpdateSchema,
  agentConversationListQuerySchema,
  agentSecretsUpdateSchema,
} from '../../automation/automation.schemas';
import { permissionProcedure, router } from '../trpc';

const idInput = z.object({ id: z.string().uuid() });

// EPIC #1018 — Otomasyon yönetimi. Konuşma içerikleri hasta yazışması taşıdığı
// için query'ler de sayfa iznine bağlı (protectedProcedure değil): yalnız
// yonetici görür. Mutasyon ayrı action izniyle.
export const automationRouterFactory = (automation: AutomationAdminService) =>
  router({
    getConfig: permissionProcedure('page:adminAutomations').query(() => automation.getConfig()),

    updateConfig: permissionProcedure('action:automation.manage')
      .input(agentConfigUpdateSchema)
      .mutation(({ input, ctx }) => automation.updateConfig(input, ctx.user!.sub)),

    // #1022 — Yönetici ekranı KPI şeridi.
    stats: permissionProcedure('page:adminAutomations').query(() => automation.stats()),

    // #1031 — "Varsayılana sıfırla" için seed prompt.
    getDefaultPrompt: permissionProcedure('page:adminAutomations').query(() =>
      automation.getDefaultPrompt(),
    ),

    // #1034 — Sırlar ekrandan (write-only) + webhook URL yönetimi.
    updateSecrets: permissionProcedure('action:automation.manage')
      .input(agentSecretsUpdateSchema)
      .mutation(({ input }) => automation.updateSecrets(input)),

    getWebhookInfo: permissionProcedure('page:adminAutomations').query(() =>
      automation.getWebhookInfo(),
    ),

    rotateWebhookSecret: permissionProcedure('action:automation.manage').mutation(() =>
      automation.rotateWebhookSecret(),
    ),

    listConversations: permissionProcedure('page:adminAutomations')
      .input(agentConversationListQuerySchema)
      .query(({ input }) => automation.listConversations(input)),

    getConversation: permissionProcedure('page:adminAutomations')
      .input(idInput)
      .query(({ input }) => automation.getConversation(input.id)),

    // #1038 — Personeldeki konuşmayı bota geri ver (HBYS ekranından).
    returnToBot: permissionProcedure('action:automation.manage')
      .input(idInput)
      .mutation(({ input, ctx }) => automation.returnToBot(input.id, ctx.user!.sub)),

    listActions: permissionProcedure('page:adminAutomations')
      .input(agentActionListQuerySchema)
      .query(({ input }) => automation.listActions(input)),
  });
