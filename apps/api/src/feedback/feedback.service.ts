import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Prisma } from '@airmed/db';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { StorageService } from '../storage/storage.service';
import { GithubIssueService } from './github-issue.service';
import { scrubPii } from './feedback.scrub';
import type { FeedbackCreateInput, FeedbackListQuery } from './feedback.schemas';

interface Actor {
  id: string;
  roles: readonly string[];
}

// I2.3 (#821) — Geri-Bildirim Merkezi: kullanıcı isteği → kayıt → GitHub issue
// (scrub'lı). Ek dosyalar storage_data volume'una.
// #881 — "Geliştirme İste" yazılım sağlayıcıya (DNA) gider; aksiyon yeri klinik
// yöneticisi DEĞİL platform gelen kutusu (#858). Bu yüzden klinik-yönetici
// farkındalık bildirimi KALDIRILDI (yönetici aksiyon alamaz → yanıltıcıydı).
const KIND_LABEL: Record<string, string> = {
  bug: 'bug',
  improvement: 'feature-request',
  question: 'question',
};
const VALID_ATTACHMENT_KINDS = new Set(['screenshot', 'video', 'file', 'annotation']);

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly storage: StorageService,
    private readonly github: GithubIssueService,
  ) {}

  async create(input: FeedbackCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const request = await this.prisma.scoped.feedbackRequest.create({
      data: {
        tenantId,
        submittedById: actor.id,
        kind: input.kind,
        title: input.title,
        description: input.description,
        routePath: input.routePath,
        appVersion: input.appVersion,
        contextJson: input.contextJson as Prisma.InputJsonValue,
        status: 'submitted',
      },
    });

    // GitHub issue — scrub'lı body + label'lar. Best-effort: başarısızsa issueNo null.
    const body = [
      scrubPii(input.description),
      '',
      `— ekran: \`${input.routePath}\` · sürüm: \`${input.appVersion}\` · tür: ${input.kind}`,
      `— feedback: \`${request.id}\``,
    ].join('\n');
    const labels = [
      KIND_LABEL[input.kind] ?? 'feature-request',
      `screen:${input.routePath}`,
      `env:${process.env.NODE_ENV ?? 'dev'}`,
    ];
    const issueNo = await this.github.createIssue({
      title: scrubPii(input.title),
      body,
      labels,
    });
    if (issueNo != null) {
      await this.prisma.scoped.feedbackRequest.update({
        where: { id: request.id },
        data: { githubIssueNo: issueNo },
      });
    }

    return { ...request, githubIssueNo: issueNo };
  }

  list(query: FeedbackListQuery, actor: Actor) {
    return this.prisma.scoped.feedbackRequest.findMany({
      where: query.mineOnly ? { submittedById: actor.id } : {},
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: { attachments: true },
    });
  }

  async addAttachment(requestId: string, file: { buffer: Buffer; mimeType: string; kind: string }) {
    if (!VALID_ATTACHMENT_KINDS.has(file.kind)) {
      throw new BadRequestException(`Geçersiz ek türü: ${file.kind}`);
    }
    const tenantId = this.tenantContext.requireTenantId();
    const request = await this.prisma.scoped.feedbackRequest.findFirst({
      where: { id: requestId },
      select: { id: true },
    });
    if (!request) throw new NotFoundException('Geri-bildirim isteği bulunamadı');

    const id = randomUUID();
    const ext = (file.mimeType.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '');
    const storageKey = `feedback/${tenantId}/${requestId}/${id}.${ext}`;
    await this.storage.saveBuffer(storageKey, file.buffer);

    return this.prisma.scoped.feedbackAttachment.create({
      data: {
        id,
        tenantId,
        requestId,
        kind: file.kind,
        storageKey,
        // Anotasyon (çizim/blur) zaten redacted; ham screenshot değil.
        redacted: file.kind === 'annotation',
      },
    });
  }
}
