import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AutomationIngestService, AUTOMATION_ADMIN_PRISMA } from './automation-ingest.service';
import { AutomationController } from './automation.controller';
import { SecretCryptoService } from './secret-crypto.service';

describe('AutomationController (webhook guard)', () => {
  let controller: AutomationController;
  let ingest: { ingest: jest.Mock };
  let secret: string | undefined;
  let dbRows: { webhookSecretEnc: string }[];

  beforeEach(async () => {
    secret = 'super-secret-token';
    dbRows = [];
    ingest = { ingest: jest.fn().mockResolvedValue({ outcome: 'ignored', reason: 'test' }) };
    const moduleRef = await Test.createTestingModule({
      controllers: [AutomationController],
      providers: [
        { provide: AutomationIngestService, useValue: ingest },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'AUTOMATION_WEBHOOK_SECRET' ? secret : undefined),
          },
        },
        // #1034 — decrypt passthrough (test satırları düz metin taşır)
        { provide: SecretCryptoService, useValue: { decrypt: (v: string) => v } },
        {
          provide: AUTOMATION_ADMIN_PRISMA,
          useValue: { agentConfig: { findMany: jest.fn(async () => dbRows) } },
        },
      ],
    }).compile();
    controller = moduleRef.get(AutomationController);
  });

  it('#1034: DB secret birincil — env olmasa da DB token doğrular', async () => {
    secret = undefined;
    dbRows = [{ webhookSecretEnc: 'db-token-123' }];
    await expect(controller.chatwootWebhook('db-token-123', { event: 'x' })).resolves.toEqual({
      ok: true,
    });
    await expect(controller.chatwootWebhook('yanlis', { event: 'x' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('doğru token ile isteği işler', async () => {
    await expect(controller.chatwootWebhook('super-secret-token', { event: 'x' })).resolves.toEqual(
      { ok: true },
    );
    expect(ingest.ingest).toHaveBeenCalled();
  });

  it('yanlış/eksik token 401', async () => {
    await expect(controller.chatwootWebhook('wrong', { event: 'x' })).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(controller.chatwootWebhook(undefined, { event: 'x' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('secret env yoksa fail-safe 503 (istek işlenmez)', async () => {
    secret = undefined;
    await expect(controller.chatwootWebhook('anything', { event: 'x' })).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('ingest hatası 200 döner (Chatwoot retry fırtınası önlenir)', async () => {
    ingest.ingest.mockRejectedValue(new Error('db down'));
    await expect(controller.chatwootWebhook('super-secret-token', { event: 'x' })).resolves.toEqual(
      { ok: true },
    );
  });
});
