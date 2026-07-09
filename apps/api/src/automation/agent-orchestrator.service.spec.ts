import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AgentOrchestratorService } from './agent-orchestrator.service';
import { AgentToolsService } from './agent-tools.service';
import { NotificationService } from '../notification/notification.service';
import { SecretCryptoService } from './secret-crypto.service';
import { AUTOMATION_ADMIN_PRISMA } from './automation-ingest.service';
import { ChatwootAdapter } from './channel-adapter';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CONV_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const MSG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('AgentOrchestratorService', () => {
  let service: AgentOrchestratorService;
  let scoped: {
    agentConfig: { findFirst: jest.Mock };
    agentConversation: { findFirst: jest.Mock; update: jest.Mock };
    agentMessage: { create: jest.Mock; updateMany: jest.Mock };
    user: { findMany: jest.Mock };
  };
  let notifications: { createForUsers: jest.Mock };
  let admin: {
    agentMessage: { updateMany: jest.Mock };
    agentConversation: { update: jest.Mock };
    agentAction: { create: jest.Mock };
  };
  let adapter: { sendMessage: jest.Mock; handoffToHuman: jest.Mock };
  let anthropic: { key: string; runTurn: jest.Mock };
  let tools: { definitions: jest.Mock; execute: jest.Mock };

  const config = {
    enabled: true,
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    systemPrompt: 'PROMPT',
    knowledgeBase: 'KB',
    channelSettings: { chatwootAccountId: 7 },
  };
  const conversation = {
    id: CONV_ID,
    chatwootConversationId: 1001,
    channel: 'whatsapp',
    status: 'bot_active',
    contactPhone: '+992001234567',
    patientId: null,
    patient: null,
    messages: [
      { id: MSG_ID, role: 'patient', content: 'Merhaba', processedAt: null, createdAt: new Date() },
    ],
  };

  beforeEach(async () => {
    scoped = {
      agentConfig: { findFirst: jest.fn().mockResolvedValue(config) },
      agentConversation: {
        findFirst: jest.fn().mockResolvedValue(conversation),
        update: jest.fn().mockResolvedValue({}),
      },
      agentMessage: {
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({}),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) },
    };
    notifications = { createForUsers: jest.fn().mockResolvedValue([]) };
    admin = {
      agentMessage: { updateMany: jest.fn().mockResolvedValue({}) },
      agentConversation: { update: jest.fn().mockResolvedValue({}) },
      agentAction: { create: jest.fn().mockResolvedValue({}) },
    };
    adapter = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      handoffToHuman: jest.fn().mockResolvedValue(undefined),
    };
    anthropic = { key: 'anthropic', runTurn: jest.fn().mockResolvedValue({ text: 'Cevap' }) };
    tools = { definitions: jest.fn().mockReturnValue([]), execute: jest.fn() };

    const prisma = {
      scoped,
      // runWithTenant testte tx açmadan direkt fn(scoped) koşar.
      runWithTenant: jest.fn(async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(scoped),
      ),
    };
    const cls = { run: jest.fn((fn: () => unknown) => fn()) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentOrchestratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClsService, useValue: cls },
        {
          provide: TenantContextService,
          useValue: { setTenantId: jest.fn(), setTransaction: jest.fn() },
        },
        { provide: AgentToolsService, useValue: tools },
        { provide: ChatwootAdapter, useValue: adapter },
        { provide: AnthropicProvider, useValue: anthropic },
        { provide: OpenRouterProvider, useValue: { key: 'openrouter', runTurn: jest.fn() } },
        { provide: NotificationService, useValue: notifications },
        { provide: SecretCryptoService, useValue: { decrypt: (v: string) => v } },
        { provide: AUTOMATION_ADMIN_PRISMA, useValue: admin },
      ],
    }).compile();
    service = moduleRef.get(AgentOrchestratorService);
  });

  it("mutlu yol: model cevabı persist edilir, pending kapanır, Chatwoot'a gönderilir", async () => {
    await service.processConversation(TENANT_ID, CONV_ID);

    expect(anthropic.runTurn).toHaveBeenCalledTimes(1);
    const req = anthropic.runTurn.mock.calls[0][0];
    expect(req.model).toBe('claude-opus-4-8');
    expect(req.systemPrompt).toContain('PROMPT');
    expect(req.systemPrompt).toContain('<bilgi_tabani>');
    expect(req.messages).toEqual([{ role: 'user', content: 'Merhaba' }]);

    expect(scoped.agentMessage.create).toHaveBeenCalled();
    const created = scoped.agentMessage.create.mock.calls[0][0].data;
    expect(created.role).toBe('assistant');
    expect(created.content).toBe('Cevap');
    expect(scoped.agentMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [MSG_ID] } },
      data: { processedAt: expect.any(Date) },
    });
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      { chatwootAccountId: 7, chatwootConversationId: 1001 },
      'Cevap',
      undefined, // #1034 — DB'de bot token yoksa adapter env fallback'ine düşer
    );
    expect(adapter.handoffToHuman).not.toHaveBeenCalled();
    expect(notifications.createForUsers).not.toHaveBeenCalled();
  });

  it('config kapalıysa hiçbir şey yapmaz', async () => {
    scoped.agentConfig.findFirst.mockResolvedValue({ ...config, enabled: false });
    await service.processConversation(TENANT_ID, CONV_ID);
    expect(anthropic.runTurn).not.toHaveBeenCalled();
    expect(adapter.sendMessage).not.toHaveBeenCalled();
  });

  it('human_active konuşmada bot susar', async () => {
    scoped.agentConversation.findFirst.mockResolvedValue({
      ...conversation,
      status: 'human_active',
    });
    await service.processConversation(TENANT_ID, CONV_ID);
    expect(anthropic.runTurn).not.toHaveBeenCalled();
  });

  it('model hatasında pending error ile kapanır + insana devredilir (hot-loop yok)', async () => {
    anthropic.runTurn.mockRejectedValue(new Error('API down'));
    await service.processConversation(TENANT_ID, CONV_ID);

    expect(admin.agentMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [MSG_ID] } },
      data: { processedAt: expect.any(Date), error: expect.stringContaining('API down') },
    });
    expect(admin.agentConversation.update).toHaveBeenCalledWith({
      where: { id: CONV_ID },
      data: { status: 'human_active', handedOffAt: expect.any(Date) },
    });
    expect(adapter.handoffToHuman).toHaveBeenCalled();
    expect(adapter.sendMessage).not.toHaveBeenCalled();
    // #1023 — hata devri de personel ziline düşer
    expect(notifications.createForUsers).toHaveBeenCalledWith(
      ['u1', 'u2'],
      expect.objectContaining({ type: 'automation_escalated' }),
    );
  });

  it('chatwootAccountId eksikse pending error ile kapanır, model hiç çağrılmaz', async () => {
    scoped.agentConfig.findFirst.mockResolvedValue({ ...config, channelSettings: {} });
    await service.processConversation(TENANT_ID, CONV_ID);
    expect(anthropic.runTurn).not.toHaveBeenCalled();
    expect(admin.agentMessage.updateMany).toHaveBeenCalled();
  });

  it('tool devir isteği: status human_active + Chatwoot open, cevap yine gönderilir', async () => {
    anthropic.runTurn.mockImplementation(
      async (req: { executeTool: (c: unknown) => Promise<unknown> }) => {
        // provider tool çağırıyormuş gibi: executor'ı sarmalayan inTenant yolunu da test eder
        tools.execute.mockImplementation(async (ctx: { handoff: { requested: boolean } }) => {
          ctx.handoff.requested = true;
          return { output: 'ok' };
        });
        await req.executeTool({ id: 't1', name: 'insana_devret', input: { reason: 'x' } });
        return { text: 'Sizi görevliye aktarıyorum.' };
      },
    );
    await service.processConversation(TENANT_ID, CONV_ID);

    const convUpdate = scoped.agentConversation.update.mock.calls[0][0].data;
    expect(convUpdate.status).toBe('human_active');
    expect(adapter.sendMessage).toHaveBeenCalled();
    expect(adapter.handoffToHuman).toHaveBeenCalled();
    // #1023 — devir bildirimi resepsiyon+yönetici kullanıcılarına, Chatwoot derin linkiyle
    const notif = notifications.createForUsers.mock.calls[0][1];
    expect(notif.type).toBe('automation_escalated');
    expect(notif.payload.chatwootUrl).toBe(
      'https://app.chatwoot.com/app/accounts/7/conversations/1001',
    );
  });

  it('personel mesajı geçmişe etiketli user olarak girer', async () => {
    scoped.agentConversation.findFirst.mockResolvedValue({
      ...conversation,
      messages: [
        {
          id: 'm0',
          role: 'staff',
          content: 'Ben ilgileniyorum',
          processedAt: new Date(),
          createdAt: new Date(Date.now() - 1000),
        },
        ...conversation.messages,
      ],
    });
    await service.processConversation(TENANT_ID, CONV_ID);
    const req = anthropic.runTurn.mock.calls[0][0];
    expect(req.messages[0]).toEqual({
      role: 'user',
      content: '[Klinik personeli yazdı]: Ben ilgileniyorum',
    });
  });
});
