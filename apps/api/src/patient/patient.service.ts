import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@airmed/db';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { PatientDoctorService } from './patient-doctor.service';
import {
  PatientCreateInput,
  PatientDuplicatesInput,
  PatientListQuery,
  PatientUpdateInput,
} from './patient.schemas';
import { verhoeffChecksum } from './verhoeff';

export interface DuplicateMatch {
  id: string;
  reason: 'phone' | 'name+birthDate';
}

/**
 * S4+S5 — Caller'dan geçen actor bağlamı. Doktor user listesi sıkı izolasyon
 * gerektiriyor (karar tutanağı §7.3i). Diğer roller (yönetici, asistan,
 * resepsiyon, hemşire) tüm tenant hastalarını görür. `userId` olmayan caller
 * (örn. cron, internal sync) `null` geçer → filtre yok.
 *
 * `flags` JWT payload'undan (S5). Doktor için iki opsiyonel davranış:
 *  - is_visiting_doctor: PatientDoctorService.patientIdsForDoctorUser bunu
 *    görür ve sadece surgery-bazlı atamaları döner.
 *  - can_see_all_patients: list filtresi tamamen bypass (yönetici override).
 *
 * `actingDoctorUserId` (S15 asistan hemşire): tek-rol hemşire aktif
 * NurseAssistanceSession ile bir doktora asiste ediyorsa, scope o doktorun
 * User.id'sine göre yapılır (hemşire Dr. X'in hastalarını görür). Set ise
 * sıkı izolasyon devreye girer; hemşirenin kendi flag'leri (can_see_all yok)
 * kullanıldığından asiste edilen doktorun standart PatientDoctor atamalarına
 * scope'lanır.
 */
export interface PatientListActor {
  userId: string;
  roles: readonly string[];
  flags?: { is_visiting_doctor?: boolean; can_see_all_patients?: boolean };
  actingDoctorUserId?: string;
}

// #1064 — liste yüzeyinin kullandığı dar alan seti (PatientListPage +
// PatientCommandPicker + CommandPalette). Yeni liste kolonu eklerken buraya da
// ekle; detay ekranı findById'nin tam satırını kullanır.
const PATIENT_LIST_SELECT = {
  id: true,
  mrn: true,
  firstName: true,
  lastName: true,
  phone: true,
  phoneLast4: true,
  birthDate: true,
  gender: true,
  tags: true,
  createdAt: true,
} as const;

@Injectable()
export class PatientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly patientDoctor: PatientDoctorService,
  ) {}

  async create(
    input: PatientCreateInput & { primaryDoctorId?: string | null },
    force = false,
    actor: { userId: string } | null = null,
  ) {
    const duplicates = await this.findDuplicates({
      firstName: input.firstName,
      lastName: input.lastName,
      birthDate: input.birthDate,
      phone: input.phone,
    });
    if (duplicates.length > 0 && !force) {
      throw new ConflictException({
        message: 'Possible duplicate patient',
        duplicates,
      });
    }

    const tenantId = this.tenantContext.requireTenantId();
    const phoneLast4 = input.phone ? toPhoneLast4(input.phone) : null;

    // S13 — MRN üretimi atomik UPSERT counter ile race-free, ama legacy/seed
    // yollarından counter sync olmamış olabilir (örn. seed-realistic eski
    // versiyonu). Defansif: P2002 unique constraint düşerse counter'ı mevcut
    // max MRN'e zorla sync edip 3 kez retry et. 3'ten sonra fail → gerçek hata.
    let created;
    let mrn = await this.nextMrn();
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        created = await this.prisma.scoped.patient.create({
          data: {
            tenantId,
            mrn,
            firstName: input.firstName,
            lastName: input.lastName,
            birthDate: new Date(input.birthDate),
            gender: input.gender,
            identityNo: input.identityNo ?? null,
            passportNo: input.passportNo ?? null,
            phone: input.phone ?? null,
            phoneLast4,
            email: input.email ?? null,
            address: input.address ?? null,
            emergencyContactName: input.emergencyContactName ?? null,
            emergencyContactPhone: input.emergencyContactPhone ?? null,
            notes: input.notes ?? null,
            leadSource: input.leadSource ?? null,
            leadSourceNote: input.leadSourceNote ?? null,
            tags: input.tags ?? [],
            allergies: input.allergies ?? [],
            anticoagulantMedications: input.anticoagulantMedications ?? [],
            bloodType: input.bloodType ?? null,
            pediatricGuardianName: input.pediatricGuardianName ?? null,
            pediatricGuardianPhone: input.pediatricGuardianPhone ?? null,
            pediatricGuardianRelationship: input.pediatricGuardianRelationship ?? null,
          },
        });
        break;
      } catch (err) {
        const e = err as { code?: string };
        if (e?.code !== 'P2002' || attempt === 3) throw err;
        // P2002: MRN zaten var (counter stale). Counter'ı max MRN'e bump et,
        // sonraki nextMrn() çağrısında doğru seq döner.
        await this.resyncMrnCounter(tenantId);
        mrn = await this.nextMrn();
      }
    }
    if (!created) {
      throw new InternalServerErrorException('MRN üretim retry tükendi');
    }

    // S4 — Manuel primary doctor (resepsiyon yeni hasta eklerken seçer).
    // Karar tutanağı §7 hibrit: bu satır 'manual' source ile primary atama.
    if (input.primaryDoctorId) {
      await this.patientDoctor.assignManual({
        tenantId,
        patientId: created.id,
        doctorId: input.primaryDoctorId,
        assignedBy: actor?.userId ?? null,
      });
    }

    return created;
  }

  async list(
    { search, tags, page, pageSize }: PatientListQuery,
    actor: PatientListActor | null = null,
  ) {
    // S4+S5 — Doktor sıkı izolasyonu (karar tutanağı §7.3i + §7.4).
    // Doktor user diğer izinli role'lere sahip değilse default sıkı izolasyon.
    // can_see_all_patients flag (S5) bunu bypass eder; is_visiting_doctor
    // ise daha kısıtlayıcı (sadece kendi cerrahileri yaptığı hastalar).
    const doctorOnlyScope = actor ? this.isDoctorOnlyScope(actor) : false;
    let scopedPatientIds: string[] | null = null;
    if (doctorOnlyScope && actor) {
      // can_see_all_patients flag → filtre tamamen kalkar (baş hekim için).
      // is_visiting_doctor override etmez — eğer hem visiting hem can_see_all,
      // visiting daha kısıtlayıcı kabul edilir (karar tutanağı §7.5).
      const isVisiting = actor.flags?.is_visiting_doctor === true;
      const canSeeAll = actor.flags?.can_see_all_patients === true;
      // Asistan hemşire ise scope asiste edilen doktorun User.id'sine göre.
      const scopeUserId = actor.actingDoctorUserId ?? actor.userId;
      if (canSeeAll && !isVisiting) {
        // Skip — scopedPatientIds null kalır, query tüm tenant döner
      } else {
        const tenantId = this.tenantContext.requireTenantId();
        scopedPatientIds = await this.patientDoctor.patientIdsForDoctorUser({
          tenantId,
          userId: scopeUserId,
          visitingOnly: isVisiting,
        });
        if (scopedPatientIds.length === 0) {
          // Hiç atanmış hasta yok → erken dönüş, query atma
          return { items: [], total: 0, page, pageSize };
        }
      }
    }

    const where = {
      deletedAt: null,
      ...(scopedPatientIds ? { id: { in: scopedPatientIds } } : {}),
      ...(search ? this.searchFilter(search) : {}),
      ...(tags && tags.length > 0 ? { tags: { hasEvery: tags } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.scoped.patient.findMany({
        where,
        // #1064 — liste dar select: UI 6-7 alan gösterirken tüm PII kolonlarını
        // (adres, kimlik, sigorta, notlar) taşımak hem IO israfı hem PII
        // maruz-kalma yüzeyi. Detay yolu (findById) tam satır döndürmeye devam eder.
        select: PATIENT_LIST_SELECT,
        orderBy: { lastName: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.patient.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findById(id: string, actor: PatientListActor | null = null) {
    const patient = await this.prisma.scoped.patient.findFirst({ where: { id, deletedAt: null } });
    if (!patient) throw new NotFoundException('Patient not found');
    // S4+S5 — Doktor sıkı izolasyonu: atanmamış hastaya findById (örn. doğrudan
    // /patients/:id URL) ile de erişemez. Bilgi sızıntısını önlemek için NotFound.
    if (actor && this.isDoctorOnlyScope(actor)) {
      const isVisiting = actor.flags?.is_visiting_doctor === true;
      const canSeeAll = actor.flags?.can_see_all_patients === true;
      if (!(canSeeAll && !isVisiting)) {
        const tenantId = this.tenantContext.requireTenantId();
        const scopeUserId = actor.actingDoctorUserId ?? actor.userId;
        const allowed = await this.patientDoctor.patientIdsForDoctorUser({
          tenantId,
          userId: scopeUserId,
          visitingOnly: isVisiting,
        });
        if (!allowed.includes(id)) throw new NotFoundException('Patient not found');
      }
    }
    return patient;
  }

  // Doktor user başka izinli role taşımıyorsa sıkı izolasyon (sadece kendi hastaları).
  // Asistan hemşire aktif session ile bir doktora asiste ediyorsa da sıkı izolasyon
  // (o doktorun hastaları); actingDoctorUserId scope user'ı belirler.
  private isDoctorOnlyScope(actor: PatientListActor): boolean {
    if (actor.actingDoctorUserId) return true;
    return (
      actor.roles.includes('doktor') &&
      !actor.roles.includes('yonetici') &&
      !actor.roles.includes('yonetici_asistani') &&
      !actor.roles.includes('resepsiyon') &&
      !actor.roles.includes('hemsire')
    );
  }

  async update(id: string, input: PatientUpdateInput) {
    await this.findById(id);
    const { birthDate, phone, ...rest } = input;
    const data: Prisma.PatientUpdateInput = { ...rest };
    if (birthDate !== undefined) data.birthDate = new Date(birthDate);
    if (phone !== undefined) {
      data.phone = phone;
      data.phoneLast4 = phone ? toPhoneLast4(phone) : null;
    }
    return this.prisma.scoped.patient.update({ where: { id }, data });
  }

  async setTags(id: string, tags: string[]) {
    await this.findById(id);
    return this.prisma.scoped.patient.update({
      where: { id },
      data: {
        tags: tags as Prisma.PatientUpdateInput['tags'],
      },
      select: { id: true, tags: true },
    });
  }

  async softDelete(id: string) {
    await this.findById(id);
    await this.prisma.scoped.patient.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * S7 — Hasta hard-delete (KVKK "right to be forgotten"). Karar tutanağı §6.1:
   * sadece yönetici (asistan dahil değil); klinik tarafında çift onay UI ile
   * tetiklenir, platform admin tarafında F4 endpoint'i ayrı çalışır.
   *
   * Patient'a bağlı çoğu child relation default RESTRICT — manuel cascade
   * yapıyoruz: PatientDoctor (zaten DB cascade), prescriptions, consent
   * signings, procedures, lab tests, photos, measurements, examinations,
   * surgeries, appointments → sonra Patient.delete(). Aynı transaction'da
   * atomik; bir child silinemezse tx rollback, kayıp yok.
   *
   * Caller actor'ı reason ile birlikte geçer; service explicit audit log
   * yazar (otomatik AuditInterceptor'a güvenmiyoruz — hard-delete kritik).
   */
  async hardDelete(
    id: string,
    actor: { userId: string; reason: string; ip?: string | null },
  ): Promise<void> {
    const tenantId = this.tenantContext.requireTenantId();
    const patient = await this.findById(id);
    const tx = this.prisma.scoped;

    // Manuel cascade — Patient'a bağlı child kayıtlar (sıralama önemli değil
    // ama explicit listede tutalım ki ileride yeni model eklendiğinde fark
    // edilsin; aksi halde patient.delete FK violation atar).
    await tx.patientDoctor.deleteMany({ where: { patientId: id } });
    await tx.prescription.deleteMany({ where: { patientId: id } });
    await tx.consentSigning.deleteMany({ where: { patientId: id } });
    await tx.procedure.deleteMany({ where: { patientId: id } });
    await tx.labTest.deleteMany({ where: { patientId: id } });
    await tx.patientPhoto.deleteMany({ where: { patientId: id } });
    await tx.measurement.deleteMany({ where: { patientId: id } });
    await tx.examination.deleteMany({ where: { patientId: id } });
    await tx.surgery.deleteMany({ where: { patientId: id } });
    await tx.appointment.deleteMany({ where: { patientId: id } });
    await tx.patient.delete({ where: { id } });

    // Explicit audit log: KVKK gereği "kim, ne zaman, neden, hangi hasta MRN".
    // patient kaydı artık DB'de yok — snapshot mrn + adı tut.
    await tx.auditLog.create({
      data: {
        tenantId,
        userId: actor.userId,
        action: 'patient.hard_delete',
        entityType: 'patient',
        entityId: id,
        payload: {
          mrn: patient.mrn,
          name: `${patient.firstName} ${patient.lastName}`,
          reason: actor.reason,
        },
        ip: actor.ip ?? null,
      },
    });
  }

  async findDuplicates(input: PatientDuplicatesInput): Promise<DuplicateMatch[]> {
    const matches: DuplicateMatch[] = [];

    if (input.phone) {
      const byPhone = await this.prisma.scoped.patient.findMany({
        where: { phone: input.phone, deletedAt: null },
        select: { id: true },
      });
      byPhone.forEach((p) => matches.push({ id: p.id, reason: 'phone' }));
    }

    const byNameDob = await this.prisma.scoped.patient.findMany({
      where: {
        firstName: { equals: input.firstName, mode: 'insensitive' },
        lastName: { equals: input.lastName, mode: 'insensitive' },
        birthDate: new Date(input.birthDate),
        deletedAt: null,
      },
      select: { id: true },
    });
    byNameDob.forEach((p) => {
      if (!matches.find((m) => m.id === p.id)) {
        matches.push({ id: p.id, reason: 'name+birthDate' });
      }
    });

    return matches;
  }

  // S13 — MRN format: <prefix(2)><yy(2)><check(1)><seq(5)>, örn "TD26700042".
  // Atomik UPSERT (RETURNING) ile race-free; yıl başında sayaç sıfırlanır.
  // Verhoeff yy+seq üzerinden hesaplanır (yıl typo'sunu da yakalar).
  private async nextMrn(): Promise<string> {
    const tenantId = this.tenantContext.requireTenantId();

    const tenant = await this.prisma.scoped.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { mrnPrefix: true, timezone: true },
    });
    if (!tenant.mrnPrefix) {
      throw new BadRequestException(
        'Klinik MRN ön eki tanımlı değil — yönetici klinik ayarlarından ekleyin.',
      );
    }

    const year = Number(
      new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        timeZone: tenant.timezone,
      }).format(new Date()),
    );

    const rows = await this.prisma.scoped.$queryRaw<{ last_seq: number }[]>`
      INSERT INTO "mrn_counters" ("tenant_id", "year", "last_seq")
      VALUES (${tenantId}::uuid, ${year}, 1)
      ON CONFLICT ("tenant_id", "year")
      DO UPDATE SET "last_seq" = "mrn_counters"."last_seq" + 1
      RETURNING "last_seq"
    `;
    const seq = rows[0].last_seq;
    if (seq > 99999) {
      throw new InternalServerErrorException(
        `MRN sıra sınırı aşıldı (yıl ${year}, sıra ${seq}). Format genişletilmeli.`,
      );
    }

    const yy = String(year).slice(-2);
    const seqStr = String(seq).padStart(5, '0');
    const check = verhoeffChecksum(yy + seqStr).toString();
    return `${tenant.mrnPrefix}${yy}${check}${seqStr}`;
  }

  /**
   * S13 — MRN counter resync: legacy/import path'leriyle mrn_counters tablosu
   * mevcut max MRN'in gerisinde kalırsa nextMrn() P2002 üretir. Bu yardımcı
   * mevcut patient tablosundan max seq'i bulup counter'a GREATEST() ile yazar.
   */
  private async resyncMrnCounter(tenantId: string): Promise<void> {
    const tenant = await this.prisma.scoped.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { mrnPrefix: true, timezone: true },
    });
    if (!tenant.mrnPrefix) return;
    const year = Number(
      new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        timeZone: tenant.timezone,
      }).format(new Date()),
    );
    const yy = String(year).slice(-2);
    // MRN format: <prefix><yy><check><seq5> — son 5 char seq.
    const rows = await this.prisma.scoped.$queryRaw<{ max_seq: number }[]>`
      SELECT COALESCE(MAX(CAST(RIGHT(mrn, 5) AS INT)), 0)::int AS max_seq
      FROM patients
      WHERE tenant_id = ${tenantId}::uuid
        AND mrn LIKE ${tenant.mrnPrefix + yy + '%'}
        AND LENGTH(mrn) = 10
    `;
    const maxSeq = rows[0]?.max_seq ?? 0;
    if (maxSeq <= 0) return;
    await this.prisma.scoped.$executeRaw`
      INSERT INTO "mrn_counters" ("tenant_id", "year", "last_seq")
      VALUES (${tenantId}::uuid, ${year}, ${maxSeq})
      ON CONFLICT ("tenant_id", "year")
      DO UPDATE SET "last_seq" = GREATEST("mrn_counters"."last_seq", ${maxSeq})
    `;
  }

  private searchFilter(search: string) {
    return {
      OR: [
        { firstName: { contains: search, mode: 'insensitive' as const } },
        { lastName: { contains: search, mode: 'insensitive' as const } },
        { phoneLast4: { contains: search } },
        { mrn: { contains: search } },
      ],
    };
  }
}

function toPhoneLast4(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-4);
}
