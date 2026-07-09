import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AutomationAdminService } from './automation-admin.service';
import { ChatwootAdapter } from './channel-adapter';
import { SecretCryptoService } from './secret-crypto.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CONFIG_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CONVERSATION_ID = '33333333-3333-3333-3333-333333333333';

describe('AutomationAdminService', () => {
  let service: AutomationAdminService;
  let chatwoot: { returnToBot: jest.Mock };
  let scoped: {
    agentConfig: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    agentConfigRevision: { create: jest.Mock };
    agentConversation: { findFirst: jest.Mock; update: jest.Mock };
    agentAction: { create: jest.Mock };
  };

  const existingConfig = {
    id: CONFIG_ID,
    tenantId: TENANT_ID,
    enabled: false,
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    systemPrompt: 'eski prompt',
    knowledgeBase: null,
    channelSettings: null,
    webhookSecretEnc: 'enc:whsec',
    chatwootBotTokenEnc: 'enc:cw-token-abcd',
    anthropicKeyEnc: null,
    openrouterKeyEnc: null,
    revision: 3,
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    scoped = {
      agentConfig: {
        findFirst: jest.fn().mockResolvedValue(existingConfig),
        create: jest.fn(async ({ data }) => ({ id: CONFIG_ID, revision: 1, ...data })),
        update: jest.fn(async ({ data }) => ({ ...existingConfig, ...data })),
      },
      agentConfigRevision: { create: jest.fn().mockResolvedValue({}) },
      agentConversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: CONVERSATION_ID,
          status: 'human_active',
          chatwootConversationId: 42,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      agentAction: { create: jest.fn().mockResolvedValue({}) },
    };
    chatwoot = { returnToBot: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AutomationAdminService,
        { provide: PrismaService, useValue: { scoped } },
        { provide: ChatwootAdapter, useValue: chatwoot },
        {
          provide: TenantContextService,
          useValue: { requireTenantId: () => TENANT_ID },
        },
        {
          provide: SecretCryptoService,
          useValue: {
            encrypt: (v: string) => `enc:${v}`,
            decrypt: (v: string) => v.replace(/^enc:/, ''),
            last4: (v: string) => v.replace(/^enc:/, '').slice(-4),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(AutomationAdminService);
  });

  it('#1034: DTO şifreli kolonları SIZDIRMAZ, yalnız durum + last4 döner', async () => {
    const dto = await service.getConfig();
    expect(dto).not.toHaveProperty('chatwootBotTokenEnc');
    expect(dto).not.toHaveProperty('webhookSecretEnc');
    expect(dto.secrets.webhook.set).toBe(true);
    expect(dto.secrets.chatwootBotToken).toEqual({ set: true, last4: 'abcd' });
    expect(dto.secrets.anthropicKey).toEqual({ set: false, last4: null });
  });

  it('#1034: updateSecrets şifreleyerek yazar (write-only) ve null siler', async () => {
    await service.updateSecrets({ anthropicKey: 'sk-ant-test-1234', chatwootBotToken: null });
    const data = scoped.agentConfig.update.mock.calls[0][0].data;
    expect(data.anthropicKeyEnc).toBe('enc:sk-ant-test-1234');
    expect(data.chatwootBotTokenEnc).toBeNull();
    expect(data).not.toHaveProperty('openrouterKeyEnc');
  });

  it('#1034: getWebhookInfo base URL + çözülmüş token ile tam URL üretir', async () => {
    scoped.agentConfig.findFirst.mockResolvedValue({
      ...existingConfig,
      channelSettings: { webhookPublicBaseUrl: 'https://ornek.ts.net:10000/' },
    });
    const info = await service.getWebhookInfo();
    expect(info.configured).toBe(true);
    expect(info.url).toBe('https://ornek.ts.net:10000/api/automation/webhook/chatwoot?token=whsec');
  });

  it('config yoksa kapalı varsayılanlarla oluşturur', async () => {
    scoped.agentConfig.findFirst.mockResolvedValue(null);
    const config = await service.getConfig();
    expect(scoped.agentConfig.create).toHaveBeenCalled();
    const data = scoped.agentConfig.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe(TENANT_ID);
    expect(data.systemPrompt).toBeTruthy();
    expect(config.id).toBe(CONFIG_ID);
  });

  it('update öncesi mevcut hâli revizyona yazar ve revision artırır', async () => {
    await service.updateConfig({ systemPrompt: 'yeni prompt', enabled: true }, USER_ID);

    const revision = scoped.agentConfigRevision.create.mock.calls[0][0].data;
    expect(revision).toMatchObject({
      configId: CONFIG_ID,
      revision: 3,
      systemPrompt: 'eski prompt',
      createdById: USER_ID,
    });

    const update = scoped.agentConfig.update.mock.calls[0][0].data;
    expect(update.systemPrompt).toBe('yeni prompt');
    expect(update.enabled).toBe(true);
    expect(update.revision).toEqual({ increment: 1 });
    // Gönderilmeyen alanlar dokunulmaz (partial update).
    expect(update).not.toHaveProperty('model');
  });

  it('#1038: returnToBot personeldeki konuşmayı bot_active yapar + aksiyon loglar + Chatwoot pending', async () => {
    scoped.agentConfig.findFirst.mockResolvedValue({
      ...existingConfig,
      channelSettings: { chatwootAccountId: 173562 },
    });
    const result = await service.returnToBot(CONVERSATION_ID, USER_ID);

    expect(result).toEqual({ id: CONVERSATION_ID, status: 'bot_active' });
    expect(scoped.agentConversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { status: 'bot_active' },
    });
    expect(scoped.agentAction.create.mock.calls[0][0].data).toMatchObject({
      tenantId: TENANT_ID,
      conversationId: CONVERSATION_ID,
      type: 'returned_to_bot',
      payload: { actorUserId: USER_ID },
    });
    // Chatwoot tarafı DB'deki bot token (çözülmüş) ile pending'e çekilir.
    expect(chatwoot.returnToBot).toHaveBeenCalledWith(
      { chatwootAccountId: 173562, chatwootConversationId: 42 },
      'cw-token-abcd',
    );
  });

  it('#1038: returnToBot Chatwoot hatasında yine başarılı döner (best-effort)', async () => {
    scoped.agentConfig.findFirst.mockResolvedValue({
      ...existingConfig,
      channelSettings: { chatwootAccountId: 173562 },
    });
    chatwoot.returnToBot.mockRejectedValue(new Error('Chatwoot API error 401'));
    const result = await service.returnToBot(CONVERSATION_ID, USER_ID);
    expect(result.status).toBe('bot_active');
    expect(scoped.agentConversation.update).toHaveBeenCalled();
  });

  it('#1038: returnToBot yalnız human_active konuşmada çalışır', async () => {
    scoped.agentConversation.findFirst.mockResolvedValue({
      id: CONVERSATION_ID,
      status: 'bot_active',
      chatwootConversationId: 42,
    });
    await expect(service.returnToBot(CONVERSATION_ID, USER_ID)).rejects.toThrow(
      'Conversation is not with staff',
    );
    expect(scoped.agentConversation.update).not.toHaveBeenCalled();
    expect(chatwoot.returnToBot).not.toHaveBeenCalled();
  });
});
