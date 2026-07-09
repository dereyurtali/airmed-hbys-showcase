import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AutomationIngestService, AUTOMATION_ADMIN_PRISMA } from './automation-ingest.service';
import type { ChatwootWebhookPayload } from './chatwoot.types';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CONV_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('AutomationIngestService', () => {
  let service: AutomationIngestService;
  let admin: {
    agentConfig: { findUnique: jest.Mock };
    agentConversation: {
      upsert: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
    };
    agentMessage: { create: jest.Mock };
    $disconnect: jest.Mock;
  };

  const incomingMessage = (
    overrides: Partial<ChatwootWebhookPayload> = {},
  ): ChatwootWebhookPayload => ({
    event: 'message_created',
    id: 42,
    content: 'Merhaba, randevu almak istiyorum',
    message_type: 'incoming',
    private: false,
    account: { id: 7 },
    conversation: {
      id: 1001,
      channel: 'Channel::Whatsapp',
      meta: { sender: { name: 'Ali Veli', phone_number: '+992001234567' } },
    },
    ...overrides,
  });

  beforeEach(async () => {
    admin = {
      agentConfig: {
        // #1070 — tenant çözümü artık index'li kolonla findUnique.
        findUnique: jest.fn().mockResolvedValue({ tenantId: TENANT_ID, enabled: true }),
      },
      agentConversation: {
        upsert: jest.fn().mockResolvedValue({ id: CONV_ID }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ id: CONV_ID, status: 'bot_active' }),
      },
      agentMessage: {
        create: jest.fn(async ({ data }) => ({
          id: 'mmmmmmmm-0000-0000-0000-000000000001',
          ...data,
        })),
      },
      $disconnect: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [AutomationIngestService, { provide: AUTOMATION_ADMIN_PRISMA, useValue: admin }],
    }).compile();
    service = moduleRef.get(AutomationIngestService);
  });

  it('hasta mesajını kuyruğa yazar (processedAt=null) ve lastMessageAt günceller', async () => {
    const result = await service.ingest(incomingMessage());
    expect(result.outcome).toBe('stored');
    const created = admin.agentMessage.create.mock.calls[0][0].data;
    expect(created.role).toBe('patient');
    expect(created.processedAt).toBeNull();
    expect(created.chatwootMessageId).toBe(42);
    expect(admin.agentConversation.update).toHaveBeenCalled();
  });

  it('config yoksa saklamadan yutar', async () => {
    admin.agentConfig.findUnique.mockResolvedValue(null);
    const result = await service.ingest(incomingMessage());
    expect(result).toEqual({ outcome: 'ignored', reason: 'no config for account' });
    expect(admin.agentMessage.create).not.toHaveBeenCalled();
  });

  it('agent kapalıysa saklamadan yutar', async () => {
    admin.agentConfig.findUnique.mockResolvedValue({ tenantId: TENANT_ID, enabled: false });
    const result = await service.ingest(incomingMessage());
    expect(result).toEqual({ outcome: 'ignored', reason: 'agent disabled' });
  });

  it('duplicate webhook teslimi (P2002) sessizce geçilir', async () => {
    admin.agentMessage.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const result = await service.ingest(incomingMessage());
    expect(result.outcome).toBe('stored');
  });

  it('private not ve bot yankısı yutulur', async () => {
    expect((await service.ingest(incomingMessage({ private: true }))).outcome).toBe('ignored');
    const echo = incomingMessage({
      message_type: 'outgoing',
      sender: { type: 'agent_bot' },
    });
    const result = await service.ingest(echo);
    expect(result.outcome).toBe('stored');
    expect(admin.agentMessage.create).not.toHaveBeenCalled();
  });

  it('personel mesajı (outgoing, insan) staff olarak işlenmiş kaydedilir', async () => {
    await service.ingest(
      incomingMessage({ message_type: 'outgoing', sender: { type: 'user', name: 'Resepsiyon' } }),
    );
    const created = admin.agentMessage.create.mock.calls[0][0].data;
    expect(created.role).toBe('staff');
    expect(created.processedAt).toBeInstanceOf(Date);
  });

  it('conversation_status_changed: open → human_active + handedOffAt', async () => {
    const result = await service.ingest({
      event: 'conversation_status_changed',
      account: { id: 7 },
      conversation: { id: 1001 },
      status: 'open',
    });
    expect(result.outcome).toBe('status_synced');
    const update = admin.agentConversation.update.mock.calls[0][0].data;
    expect(update.status).toBe('human_active');
    expect(update.handedOffAt).toBeInstanceOf(Date);
  });

  it('#1036: HESAP webhook formu — konuşma alanları kökte (id + status + account_id)', async () => {
    admin.agentConversation.findUnique.mockResolvedValue({ id: CONV_ID, status: 'human_active' });
    const result = await service.ingest({
      event: 'conversation_status_changed',
      account_id: 7,
      id: 1001,
      status: 'pending',
    } as never);
    expect(result.outcome).toBe('status_synced');
    const update = admin.agentConversation.update.mock.calls[0][0].data;
    expect(update.status).toBe('bot_active');
  });

  it('#1036: status olayında pending → bot_active (personel botu geri verdi)', async () => {
    admin.agentConversation.findUnique.mockResolvedValue({ id: CONV_ID, status: 'human_active' });
    const result = await service.ingest({
      event: 'conversation_status_changed',
      account: { id: 7 },
      conversation: { id: 1001 },
      status: 'pending',
    });
    expect(result.outcome).toBe('status_synced');
    expect(admin.agentConversation.update.mock.calls[0][0].data.status).toBe('bot_active');
  });

  it('status no-op ise güncelleme yapılmaz', async () => {
    admin.agentConversation.findUnique.mockResolvedValue({ id: CONV_ID, status: 'closed' });
    const result = await service.ingest({
      event: 'conversation_status_changed',
      account: { id: 7 },
      conversation: { id: 1001 },
      status: 'resolved',
    });
    expect(result.outcome).toBe('ignored');
    expect(admin.agentConversation.update).not.toHaveBeenCalled();
  });
});
