import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { StorageService } from '../storage/storage.service';
import { GithubIssueService } from './github-issue.service';
import { FeedbackService } from './feedback.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const REQ_ID = '22222222-2222-2222-2222-222222222222';
const ACTOR = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles: ['yonetici'] };

describe('FeedbackService', () => {
  let service: FeedbackService;
  let scoped: Record<string, Record<string, jest.Mock>>;
  let storage: { saveBuffer: jest.Mock };
  let github: { createIssue: jest.Mock };

  beforeEach(async () => {
    scoped = {
      feedbackRequest: {
        create: jest.fn(async ({ data }) => ({ id: REQ_ID, ...data })),
        update: jest.fn(async ({ data }) => ({ id: REQ_ID, ...data })),
        findFirst: jest.fn().mockResolvedValue({ id: REQ_ID }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      feedbackAttachment: {
        create: jest.fn(async ({ data }) => ({ ...data })),
      },
    };
    storage = { saveBuffer: jest.fn().mockResolvedValue(undefined) };
    github = { createIssue: jest.fn().mockResolvedValue(123) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: PrismaService, useValue: { scoped } },
        { provide: TenantContextService, useValue: { requireTenantId: () => TENANT_ID } },
        { provide: StorageService, useValue: storage },
        { provide: GithubIssueService, useValue: github },
      ],
    }).compile();
    service = moduleRef.get(FeedbackService);
  });

  const input = {
    kind: 'bug' as const,
    title: 'Sira ekrani donuyor',
    description: 'Hasta foto@klinik.tj 992123456789 ile cokuyor',
    routePath: '/worklist',
    appVersion: '0.4.2',
    contextJson: { role: 'yonetici' },
  };

  it('create: kayit + GitHub issue (PII scrub) + issueNo update (klinik bildirim YOK)', async () => {
    const res = await service.create(input, ACTOR);
    expect(scoped.feedbackRequest.create).toHaveBeenCalled();
    expect(github.createIssue).toHaveBeenCalled();
    // PII scrub: e-posta + uzun rakam dizisi maskelendi
    const issueBody = github.createIssue.mock.calls[0][0].body as string;
    expect(issueBody).not.toContain('foto@klinik.tj');
    expect(issueBody).toContain('[e-posta]');
    expect(issueBody).toContain('[numara]');
    expect(scoped.feedbackRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { githubIssueNo: 123 } }),
    );
    expect(res.githubIssueNo).toBe(123);
  });

  it('create: GitHub kapali (null) -> update yok, yine de kayit doner', async () => {
    github.createIssue.mockResolvedValue(null);
    const res = await service.create(input, ACTOR);
    expect(scoped.feedbackRequest.update).not.toHaveBeenCalled();
    expect(res.githubIssueNo).toBeNull();
  });

  it('addAttachment: storage + kayit; storageKey PII-siz (tenant/request/uuid)', async () => {
    const att = await service.addAttachment(REQ_ID, {
      buffer: Buffer.from('x'),
      mimeType: 'image/png',
      kind: 'screenshot',
    });
    expect(storage.saveBuffer).toHaveBeenCalled();
    expect(scoped.feedbackAttachment.create).toHaveBeenCalled();
    expect(att.storageKey).toContain(`feedback/${TENANT_ID}/${REQ_ID}/`);
  });

  it('addAttachment: gecersiz tur reddedilir (BadRequest)', async () => {
    await expect(
      service.addAttachment(REQ_ID, {
        buffer: Buffer.from('x'),
        mimeType: 'image/png',
        kind: 'malicious',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
