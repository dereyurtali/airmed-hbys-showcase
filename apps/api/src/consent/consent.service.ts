import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@airmed/db';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  ConsentRevokeInput,
  ConsentSignInput,
  ConsentTemplateCreateInput,
  ConsentTemplateListQuery,
  ConsentTemplateUpdateInput,
} from './consent.schemas';

/** S15-PR7 — Pediatrik onam guard'ı için hasta yaşı (UN CRC reşitlik eşiği). */
function calculateAge(birthDate: Date): number | null {
  if (!birthDate || !(birthDate instanceof Date) || Number.isNaN(birthDate.getTime())) {
    return null;
  }
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return age;
}

// C2 Consent servisi.
//
// Yetki:
//   - Şablon CRUD: yalnızca `yonetici`. Klinik sahibi hukuki metni yönetir.
//   - İmza: yonetici, yonetici_asistani, doktor, hemsire.
//   - İmza okuma (listByPatient): tüm klinik personeli (hasta dosyasının
//     parçası, resepsiyon dahil görür ama imzalayamaz).
//   - Revoke: yalnızca `yonetici`. Hukuki olarak iptal etmek nadirdir;
//     genellikle yeni bir "iptal onamı" oluşturulur, mevcut imza dokunulmaz.
//
// İmza akışı:
//   1. Aktif şablonu çek (procedureType + language + isActive + en yüksek version)
//   2. ConsentSigning oluştur — şablon içeriğini contentSnapshot'a kopyala.
//      İçerik dond ediltirildiğinden, şablon sonradan değişse bile imzalanan
//      metin hukuki kayıtta korunur.
//   3. Aynı transaction içinde: surgeryId varsa ve PreOp varsa, checklist
//      "consent_signed" maddesini otomatik tamamlanmış işaretle.
//
// İmmutability: contentSnapshot + signatureData hiçbir koşulda update edilmez.
// Düzeltme = yeni signing kaydı. Revoke = revokedAt + revokeReason set edilir,
// orijinal alanlar dokunulmaz.

interface Actor {
  id: string;
  roles: readonly string[];
}

const ADMIN_ROLES = ['yonetici'] as const;
// S10d 1.1 — Hemşire çıkartıldı: onam imzası yasal sorumluluk (doktor onayı).
// Hemşire şahit olabilir ama imzayı doktor alır. Registry ile hizalı.
const SIGN_ROLES = ['yonetici', 'yonetici_asistani', 'doktor'] as const;

const TEMPLATE_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ConsentTemplateInclude;

const SIGNING_INCLUDE = {
  template: {
    select: { id: true, procedureType: true, language: true, version: true, title: true },
  },
  signedBy: { select: { id: true, name: true } },
  patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
  surgery: { select: { id: true, type: true, scheduledAt: true } },
} satisfies Prisma.ConsentSigningInclude;

@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ============================ Templates ============================

  async createTemplate(input: ConsentTemplateCreateInput, actor: Actor) {
    this.assertAdmin(actor);
    const tenantId = this.tenantContext.requireTenantId();

    // Yeni version = mevcut max version + 1. Aynı procedure+language için
    // tek aktif sürüm; yeni eklenince eskileri pasifleştir.
    const latest = await this.prisma.scoped.consentTemplate.findFirst({
      where: {
        procedureType: input.procedureType,
        language: input.language,
        deletedAt: null,
      },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    // Request zaten TenantInterceptor transaction'ı içinde — scoped client tx'in
    // kendisi. Nested transaction yerine ardışık çağrı.
    await this.prisma.scoped.consentTemplate.updateMany({
      where: {
        tenantId,
        procedureType: input.procedureType,
        language: input.language,
        isActive: true,
      },
      data: { isActive: false },
    });
    return this.prisma.scoped.consentTemplate.create({
      data: {
        tenantId,
        procedureType: input.procedureType,
        language: input.language,
        version: nextVersion,
        title: input.title,
        content: input.content,
        createdById: actor.id,
      },
      include: TEMPLATE_INCLUDE,
    });
  }

  async updateTemplate(input: ConsentTemplateUpdateInput, actor: Actor) {
    this.assertAdmin(actor);
    const existing = await this.requireTemplate(input.id);

    // Sürüm artırmadan içerik güncellemeye izin verilir — şablon henüz hiç
    // imzalanmadıysa düzeltme normal. İmza varsa ise frontend yeni version
    // oluşturmaya yönlendirir; servis blocking yapmaz çünkü imzalananlar
    // contentSnapshot ile zaten korunuyor.
    const data: Prisma.ConsentTemplateUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.content !== undefined) data.content = input.content;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return this.prisma.scoped.consentTemplate.update({
      where: { id: existing.id },
      data,
      include: TEMPLATE_INCLUDE,
    });
  }

  async deleteTemplate(id: string, actor: Actor) {
    this.assertAdmin(actor);
    const existing = await this.requireTemplate(id);
    await this.prisma.scoped.consentTemplate.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async listTemplates(query: ConsentTemplateListQuery) {
    const where: Prisma.ConsentTemplateWhereInput = { deletedAt: null };
    if (query.procedureType) where.procedureType = query.procedureType;
    if (query.language) where.language = query.language;
    if (!query.includeInactive) where.isActive = true;

    return this.prisma.scoped.consentTemplate.findMany({
      where,
      orderBy: [{ procedureType: 'asc' }, { language: 'asc' }, { version: 'desc' }],
      include: TEMPLATE_INCLUDE,
    });
  }

  async getTemplate(id: string) {
    return this.requireTemplate(id);
  }

  // ============================ Signings ============================

  async sign(input: ConsentSignInput, actor: Actor, ipAddress: string | null) {
    this.assertSignRole(actor);
    const tenantId = this.tenantContext.requireTenantId();

    const template = await this.requireTemplate(input.templateId);
    if (!template.isActive) {
      throw new BadRequestException('Cannot sign with an inactive template');
    }

    // Hasta var mı + bu tenant'a ait mi? scoped client RLS sayesinde kendi
    // tenant'ı dışındaki hastayı zaten görmez. PR7: birthDate de okunur
    // (pediatrik veli onam guard'ı için).
    const patient = await this.prisma.scoped.patient.findFirst({
      where: { id: input.patientId, deletedAt: null },
      select: { id: true, birthDate: true },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    // S15-PR7 — Pediatrik veli onam: hasta yaş <18 ise signedByGuardian=true
    // + guardianName + guardianRelationship zorunlu. KVKK + Tacik veri yasası
    // gereği veli imzası reşit olmayan hastalar için tek geçerli yöntem.
    const age = calculateAge(patient.birthDate);
    const isPediatric = age !== null && age < 18;
    if (isPediatric && !input.signedByGuardian) {
      throw new BadRequestException(
        `Hasta ${age} yaşında (reşit değil): veli imzası zorunlu. signedByGuardian=true + guardianName + guardianRelationship gerekli.`,
      );
    }
    if (input.signedByGuardian) {
      if (!input.guardianName) {
        throw new BadRequestException('Veli imzası için guardianName zorunlu');
      }
      if (!input.guardianRelationship) {
        throw new BadRequestException('Veli imzası için guardianRelationship zorunlu');
      }
    }

    let surgeryId: string | undefined;
    if (input.surgeryId) {
      const surgery = await this.prisma.scoped.surgery.findFirst({
        where: { id: input.surgeryId, deletedAt: null },
        select: { id: true, patientId: true },
      });
      if (!surgery) throw new NotFoundException('Surgery not found');
      if (surgery.patientId !== input.patientId) {
        throw new BadRequestException('Surgery does not belong to this patient');
      }
      surgeryId = surgery.id;
    }

    const signing = await this.prisma.scoped.consentSigning.create({
      data: {
        tenantId,
        templateId: template.id,
        patientId: input.patientId,
        surgeryId,
        language: template.language,
        contentSnapshot: template.content,
        signatureData: input.signatureData,
        signedByUserId: actor.id,
        witnessName: input.witnessName ?? null,
        ipAddress,
        // S15-PR7 — Pediatrik veli onam alanları (eğer signedByGuardian=true).
        signedByGuardian: input.signedByGuardian ?? false,
        guardianName: input.guardianName ?? null,
        guardianRelationship: input.guardianRelationship ?? null,
        guardianIdentityNo: input.guardianIdentityNo ?? null,
      },
      include: SIGNING_INCLUDE,
    });

    // B3 entegrasyon: bu surgery için PreOp varsa, consent_signed checklist
    // maddesini otomatik tamamlanmış işaretle. PreOp yoksa sessizce geç —
    // pre-op henüz oluşturulmamış olabilir; oluşturulduğunda manuel işaretlenir.
    // Aynı request transaction'ı içinde olduğumuz için ek tx açmaya gerek yok.
    if (surgeryId) {
      const preOp = await this.prisma.scoped.preOp.findFirst({
        where: { surgeryId, deletedAt: null },
        select: { id: true, checklistItems: true, readyForSurgery: true },
      });
      if (preOp && !preOp.readyForSurgery) {
        const items = this.parseChecklist(preOp.checklistItems);
        const idx = items.findIndex((i) => i.key === 'consent_signed');
        const patched = {
          key: 'consent_signed',
          completed: true,
          completedById: actor.id,
          completedAt: new Date().toISOString(),
          notes: null,
        };
        if (idx === -1) items.push(patched);
        else items[idx] = patched;
        await this.prisma.scoped.preOp.update({
          where: { id: preOp.id },
          data: { checklistItems: items as unknown as Prisma.InputJsonValue },
        });
      }
    }

    return signing;
  }

  async revoke(input: ConsentRevokeInput, actor: Actor) {
    this.assertAdmin(actor);
    const signing = await this.prisma.scoped.consentSigning.findFirst({
      where: { id: input.signingId },
    });
    if (!signing) throw new NotFoundException('Consent signing not found');
    if (signing.revokedAt) {
      throw new ConflictException('This consent is already revoked');
    }

    return this.prisma.scoped.consentSigning.update({
      where: { id: signing.id },
      data: { revokedAt: new Date(), revokeReason: input.reason },
      include: SIGNING_INCLUDE,
    });
  }

  async listByPatient(patientId: string, includeRevoked: boolean) {
    return this.prisma.scoped.consentSigning.findMany({
      where: {
        patientId,
        ...(includeRevoked ? {} : { revokedAt: null }),
      },
      orderBy: { signedAt: 'desc' },
      include: SIGNING_INCLUDE,
      // #1064 — tarihçe tavanı.
      take: 200,
    });
  }

  async getSigning(signingId: string) {
    const signing = await this.prisma.scoped.consentSigning.findFirst({
      where: { id: signingId },
      include: SIGNING_INCLUDE,
    });
    if (!signing) throw new NotFoundException('Consent signing not found');
    return signing;
  }

  // ============================ Helpers ============================

  private async requireTemplate(id: string) {
    const tpl = await this.prisma.scoped.consentTemplate.findFirst({
      where: { id, deletedAt: null },
      include: TEMPLATE_INCLUDE,
    });
    if (!tpl) throw new NotFoundException('Consent template not found');
    return tpl;
  }

  private assertAdmin(actor: Actor): void {
    const ok = actor.roles.some((r) => ADMIN_ROLES.includes(r as 'yonetici'));
    if (!ok) throw new ForbiddenException('Only yonetici can manage consent templates');
  }

  private assertSignRole(actor: Actor): void {
    const ok = actor.roles.some((r) => SIGN_ROLES.includes(r as 'yonetici'));
    if (!ok) throw new ForbiddenException('Role not allowed to sign consent');
  }

  private parseChecklist(raw: Prisma.JsonValue): Array<{
    key: string;
    completed: boolean;
    completedById?: string | null;
    completedAt?: string | null;
    notes?: string | null;
  }> {
    if (!Array.isArray(raw)) return [];
    const out: Array<{
      key: string;
      completed: boolean;
      completedById?: string | null;
      completedAt?: string | null;
      notes?: string | null;
    }> = [];
    for (const it of raw) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
      const c = it as Record<string, unknown>;
      if (typeof c.key !== 'string' || typeof c.completed !== 'boolean') continue;
      out.push({
        key: c.key,
        completed: c.completed,
        completedById: typeof c.completedById === 'string' ? c.completedById : null,
        completedAt: typeof c.completedAt === 'string' ? c.completedAt : null,
        notes: typeof c.notes === 'string' ? c.notes : null,
      });
    }
    return out;
  }
}
