import { FeedbackStatusTask } from './feedback-status.task';
import { PrismaService } from '../prisma/prisma.service';
import { GithubIssueService } from './github-issue.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const FB = '22222222-2222-2222-2222-222222222222';
const USER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('FeedbackStatusTask', () => {
  let task: FeedbackStatusTask;
  let findMany: jest.Mock;
  let runWithTenant: jest.Mock;
  let updateMany: jest.Mock;
  let notifCreate: jest.Mock;
  let getIssueStatus: jest.Mock;

  beforeEach(() => {
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    notifCreate = jest.fn().mockResolvedValue({});
    const tx = { feedbackRequest: { updateMany }, notification: { create: notifCreate } };
    findMany = jest.fn().mockResolvedValue([
      {
        id: FB,
        tenantId: TENANT,
        submittedById: USER,
        githubIssueNo: 42,
        status: 'submitted',
        title: 'Test',
      },
    ]);
    runWithTenant = jest.fn((_tid: string, fn: (t: typeof tx) => unknown) => fn(tx));
    getIssueStatus = jest.fn();
    const prisma = { feedbackRequest: { findMany }, runWithTenant } as unknown as PrismaService;
    const github = { getIssueStatus, enabled: true } as unknown as GithubIssueService;
    task = new FeedbackStatusTask(prisma, github);
  });

  it('shipped: status + shippedVersion günceller + isteği açana bildirim', async () => {
    getIssueStatus.mockResolvedValue({ status: 'shipped', shippedVersion: '0.4.3' });
    const res = await task.scan();
    expect(res.updated).toBe(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: FB, status: 'submitted' },
        data: expect.objectContaining({ status: 'shipped', shippedVersion: '0.4.3' }),
      }),
    );
    expect(notifCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'feature_request_status',
          recipientUserId: USER,
          tenantId: TENANT,
        }),
      }),
    );
  });

  it('durum aynıysa güncelleme/bildirim yok', async () => {
    getIssueStatus.mockResolvedValue({ status: 'submitted', shippedVersion: null });
    const res = await task.scan();
    expect(res.updated).toBe(0);
    expect(runWithTenant).not.toHaveBeenCalled();
  });

  it('github null (token yok / hata) → atlar', async () => {
    getIssueStatus.mockResolvedValue(null);
    const res = await task.scan();
    expect(res.updated).toBe(0);
    expect(runWithTenant).not.toHaveBeenCalled();
  });
});
