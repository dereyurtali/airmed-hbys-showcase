import { Injectable, Logger } from '@nestjs/common';

export interface GithubIssueInput {
  title: string;
  body: string;
  labels: string[];
}

export type FeedbackStatus = 'submitted' | 'in_progress' | 'shipped' | 'rejected';

export interface GithubIssueStatus {
  status: FeedbackStatus;
  shippedVersion: string | null;
}

// I2.3 (#821) — Geri-bildirimi GitHub issue'suna çevirir. Token/repo env'i yoksa
// (dev/staging) sessizce atlar → issueNo null (akış kırılmaz). Prod'da
// GITHUB_TOKEN + GITHUB_FEEDBACK_REPO ("owner/repo") set edilir.
@Injectable()
export class GithubIssueService {
  private readonly logger = new Logger(GithubIssueService.name);
  private readonly token = process.env.GITHUB_TOKEN;
  private readonly repo = process.env.GITHUB_FEEDBACK_REPO;

  get enabled(): boolean {
    return Boolean(this.token && this.repo);
  }

  async createIssue(input: GithubIssueInput): Promise<number | null> {
    if (!this.enabled) {
      this.logger.warn('GitHub issue atlandı (GITHUB_TOKEN / GITHUB_FEEDBACK_REPO yok)');
      return null;
    }
    try {
      const res = await fetch(`https://api.github.com/repos/${this.repo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels }),
      });
      if (!res.ok) {
        this.logger.error(`GitHub issue başarısız: ${res.status} ${await res.text()}`);
        return null;
      }
      const data = (await res.json()) as { number: number };
      return data.number;
    } catch (err) {
      this.logger.error(`GitHub issue hatası: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // I2.5 (#823) — issue durumunu çek → feedback status'üne eşle. open + "in
  // progress" label = in_progress; closed+not_planned = rejected; closed = shipped
  // (varsa vX.Y label'ı shippedVersion). Token yoksa null (poll atlanır).
  async getIssueStatus(issueNo: number): Promise<GithubIssueStatus | null> {
    if (!this.enabled) return null;
    try {
      const res = await fetch(`https://api.github.com/repos/${this.repo}/issues/${issueNo}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) {
        this.logger.warn(`GitHub durum çekilemedi #${issueNo}: ${res.status}`);
        return null;
      }
      const data = (await res.json()) as {
        state: string;
        state_reason: string | null;
        labels: Array<{ name: string } | string>;
      };
      const labels = data.labels.map((l) => (typeof l === 'string' ? l : l.name));
      if (data.state === 'closed') {
        if (data.state_reason === 'not_planned') {
          return { status: 'rejected', shippedVersion: null };
        }
        const versionLabel = labels.find((l) => /^v?\d+\.\d+/.test(l)) ?? null;
        return { status: 'shipped', shippedVersion: versionLabel?.replace(/^v/, '') ?? null };
      }
      const inProgress = labels.some((l) => /in[-\s]?progress|yap[ıi]l[ıi]yor/i.test(l));
      return { status: inProgress ? 'in_progress' : 'submitted', shippedVersion: null };
    } catch (err) {
      this.logger.warn(
        `GitHub durum hatası #${issueNo}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
