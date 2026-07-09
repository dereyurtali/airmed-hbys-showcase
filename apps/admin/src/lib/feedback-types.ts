// `/platform/feedback` cross-tenant gelen kutusu satırı.
export type FeedbackKind = 'bug' | 'improvement' | 'question';
export type FeedbackStatus = 'submitted' | 'in_progress' | 'shipped' | 'rejected';

export interface PlatformFeedbackRow {
  id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  title: string;
  description: string;
  routePath: string;
  appVersion: string;
  githubIssueNo: number | null;
  shippedVersion: string | null;
  createdAt: string;
  tenant: { id: string; name: string; slug: string };
  submittedBy: { email: string };
}
