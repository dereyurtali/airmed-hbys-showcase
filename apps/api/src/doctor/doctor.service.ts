import { BadRequestException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Doctor, DoctorAvailability } from '@airmed/db';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { StorageService } from '../storage/storage.service';
import { matchesMagicBytes } from '../storage/magic-bytes';
import {
  AvailabilitySlotInput,
  DoctorCreateInput,
  DoctorListQuery,
  DoctorUpdateInput,
  LeaveCreateInput,
  LeaveListQuery,
  LeaveRangeQuery,
  SetAvailabilityInput,
  VisitingWindowCreateInput,
  VisitingWindowListQuery,
  VisitingWindowRangeQuery,
} from './doctor.schemas';

// #1049 — `bio` Prisma'da JsonValue (özyinelemeli tip) döner; tRPC AppRouter
// inference'ını TS2589'a itmemek için wire tipi burada sabitlenir.
export interface DoctorBio {
  tr?: string;
  ru?: string;
  tg?: string;
}
export type DoctorRow = Omit<Doctor, 'bio'> & { bio: DoctorBio | null };
// #1149 — hesaplı doktorda kimlik/iletişim tek kaynağı linkli User hesabı.
// Doktor klinik ekranı ad/telefon/e-posta'yı buradan readonly gösterir; staff
// doktorda Doctor.contactPhone/Email boş kalır (AdminUsersPage create'i set etmez).
export type DoctorLinkedUser = {
  flags: Record<string, boolean> | null;
  name: string;
  phone: string | null;
  email: string;
  status: string;
};
export type DoctorDetailRow = DoctorRow & {
  availabilities: DoctorAvailability[];
  user: DoctorLinkedUser | null;
};

@Injectable()
export class DoctorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly storage: StorageService,
  ) {}

  async create(input: DoctorCreateInput) {
    const tenantId = this.tenantContext.requireTenantId();
    return this.prisma.scoped.doctor.create({
      data: {
        tenantId,
        name: input.name,
        specialty: input.specialty,
        type: input.type,
        contactPhone: input.contactPhone ?? null,
        contactEmail: input.contactEmail ?? null,
        commissionRate: input.commissionRate ?? null,
        isActive: input.isActive,
        notes: input.notes ?? null,
        // #1049 — hasta-facing profil alanları
        title: input.title ?? null,
        ...(input.bio ? { bio: input.bio } : {}),
        ...(input.languages ? { languages: input.languages } : {}),
        ...(input.publicProfile !== undefined ? { publicProfile: input.publicProfile } : {}),
      },
    }) as Promise<DoctorRow>;
  }

  async list({ search, specialty, type, isActive, page, pageSize }: DoctorListQuery) {
    const where: Prisma.DoctorWhereInput = {
      deletedAt: null,
      ...(specialty ? { specialty: { equals: specialty, mode: 'insensitive' } } : {}),
      ...(type ? { type } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { specialty: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.scoped.doctor.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.doctor.count({ where }),
    ]);
    return { items: items as DoctorRow[], total, page, pageSize };
  }

  async findById(id: string) {
    const doctor = await this.prisma.scoped.doctor.findFirst({
      where: { id, deletedAt: null },
      include: {
        availabilities: {
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        },
        // S8b — user.flags S8 admin toggle UI'da gösterilir.
        // #1149 — hesaplı doktorda kimlik/iletişim tek kaynağı hesap; klinik
        // ekran ad/telefon/e-posta/durum'u buradan readonly gösterir.
        user: { select: { flags: true, name: true, phone: true, email: true, status: true } },
      },
    });
    if (!doctor) throw new NotFoundException('Doctor not found');
    return doctor as DoctorDetailRow;
  }

  // S15 — Giriş yapan kullanıcının doktor profili (Doctor.userId @unique).
  // Worklist + takvim "kendi hastalarım" filtresi için. Profil yoksa null
  // (visiting doctor user hesabı yok / kullanıcı doktor değil).
  // #1048 — type: doctor.list çekemeyen sadece-doktor kullanıcının takvimi
  // misafir pencere overlay'ini kendi profilinden bilsin diye eklendi.
  myProfile(userId: string) {
    return this.prisma.scoped.doctor.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true, name: true, specialty: true, type: true },
    });
  }

  async update(id: string, input: DoctorUpdateInput) {
    const existing = await this.findById(id);
    const data: Prisma.DoctorUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.specialty !== undefined) data.specialty = input.specialty;
    if (input.type !== undefined) data.type = input.type;
    if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
    if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail;
    if (input.commissionRate !== undefined) data.commissionRate = input.commissionRate;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.notes !== undefined) data.notes = input.notes;
    // #1049 — hasta-facing profil alanları
    if (input.title !== undefined) data.title = input.title;
    if (input.bio !== undefined) data.bio = input.bio === null ? Prisma.JsonNull : input.bio;
    if (input.languages !== undefined) data.languages = input.languages;
    if (input.publicProfile !== undefined) data.publicProfile = input.publicProfile;
    const updated = (await this.prisma.scoped.doctor.update({ where: { id }, data })) as DoctorRow;
    // #1047 — Doctor.type kanonik; tip alanından değişince user.flags'taki
    // is_visiting_doctor da senkron kalmalı (iki giriş noktası ayrışmasın).
    if (input.type !== undefined && existing.userId) {
      await this.syncUserVisitingFlag(existing.userId, input.type === 'visiting');
    }
    return updated;
  }

  async softDelete(id: string) {
    await this.findById(id);
    await this.prisma.scoped.doctor.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /**
   * S8b — Doktor user flag toggle (karar tutanağı §3, §7.4-5):
   *  - can_see_all_patients: baş hekim için sıkı izolasyonu kaldır
   *  - is_visiting_doctor: misafir cerrah, sadece kendi cerrahileri
   *
   * Doctor.userId üzerinden ilgili User'a yansıtılır (flag user-level, doctor
   * profilinde değil; aynı user başka doctor profilinde olmaz çünkü Doctor.userId
   * @unique). Yönetici tetikler — permission tRPC katmanında kontrol.
   */
  async updateDoctorUserFlags(
    doctorId: string,
    flags: { is_visiting_doctor?: boolean; can_see_all_patients?: boolean },
  ): Promise<{ ok: true }> {
    const doctor = await this.findById(doctorId);
    if (!doctor.userId) {
      throw new NotFoundException('Doctor profile has no user (visiting profile only)');
    }
    // Mevcut user.flags ile merge — başka flag'leri (ileride eklenir)
    // korumak için patch pattern; null/undefined keyleri sil.
    const user = await this.prisma.scoped.user.findUnique({
      where: { id: doctor.userId },
      select: { flags: true },
    });
    const current = (user?.flags ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current };
    for (const k of ['is_visiting_doctor', 'can_see_all_patients'] as const) {
      if (flags[k] === undefined) continue;
      if (flags[k]) next[k] = true;
      else delete next[k];
    }
    await this.prisma.scoped.user.update({
      where: { id: doctor.userId },
      data: {
        flags: Object.keys(next).length > 0 ? (next as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
    // #1047 — Doctor.type kanonik: flag toggle'ı tip ile senkron. true →
    // visiting; false → yalnız visiting'den local'e indir (referral'a dokunma).
    if (flags.is_visiting_doctor !== undefined) {
      if (flags.is_visiting_doctor && doctor.type !== 'visiting') {
        await this.prisma.scoped.doctor.update({
          where: { id: doctorId },
          data: { type: 'visiting' },
        });
      } else if (!flags.is_visiting_doctor && doctor.type === 'visiting') {
        await this.prisma.scoped.doctor.update({
          where: { id: doctorId },
          data: { type: 'local' },
        });
      }
    }
    return { ok: true };
  }

  // #1047 — update(type) yolu için user.flags.is_visiting_doctor senkronu.
  private async syncUserVisitingFlag(userId: string, isVisiting: boolean): Promise<void> {
    const user = await this.prisma.scoped.user.findUnique({
      where: { id: userId },
      select: { flags: true },
    });
    const current = (user?.flags ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current };
    if (isVisiting) next.is_visiting_doctor = true;
    else delete next.is_visiting_doctor;
    await this.prisma.scoped.user.update({
      where: { id: userId },
      data: {
        flags: Object.keys(next).length > 0 ? (next as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }

  /**
   * Replace-all weekly schedule. Validates that slots on the same day don't
   * overlap (a doctor can have multiple disjoint windows per day, e.g.
   * 09:00-12:00 + 14:00-17:00, but never overlapping ones).
   *
   * `prisma.scoped` is already the request-level tenant transaction (opened
   * by TenantInterceptor) — delete + createMany run atomically inside it,
   * so we don't open a nested $transaction here.
   */
  async setAvailability(doctorId: string, input: SetAvailabilityInput) {
    await this.findById(doctorId);
    assertNoOverlaps(input.slots);
    const tenantId = this.tenantContext.requireTenantId();
    const tx = this.prisma.scoped;

    await tx.doctorAvailability.deleteMany({ where: { doctorId } });
    if (input.slots.length > 0) {
      await tx.doctorAvailability.createMany({
        data: input.slots.map((s) => ({
          tenantId,
          doctorId,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          isActive: s.isActive,
        })),
      });
    }
    return tx.doctorAvailability.findMany({
      where: { doctorId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async listAvailability(doctorId: string) {
    await this.findById(doctorId);
    return this.prisma.scoped.doctorAvailability.findMany({
      where: { doctorId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  // A5 izin/tatil — leave CRUD + range query.
  async addLeave(input: LeaveCreateInput) {
    await this.findById(input.doctorId);
    const tenantId = this.tenantContext.requireTenantId();
    return this.prisma.scoped.doctorLeave.create({
      data: {
        tenantId,
        doctorId: input.doctorId,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        reason: input.reason ?? null,
      },
    });
  }

  async listLeaves({ doctorId, from }: LeaveListQuery) {
    await this.findById(doctorId);
    const since = from ? new Date(from) : new Date();
    // Aktif + gelecek izinler: bitişi `since`'tan sonra olanlar (yarısı
    // geçmiş bir izin hala aktif sayılır).
    return this.prisma.scoped.doctorLeave.findMany({
      where: {
        doctorId,
        endsAt: { gt: since },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  async findLeavesInRange({ doctorId, dateFrom, dateTo }: LeaveRangeQuery) {
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    // Pencerede [dateFrom, dateTo) ile çakışan tüm izinler (klasik overlap test:
    // startsAt < end AND endsAt > start).
    return this.prisma.scoped.doctorLeave.findMany({
      where: {
        ...(doctorId ? { doctorId } : {}),
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
      include: { doctor: { select: { id: true, name: true } } },
      orderBy: { startsAt: 'asc' },
    });
  }

  async deleteLeave(id: string) {
    const leave = await this.prisma.scoped.doctorLeave.findFirst({ where: { id } });
    if (!leave) throw new NotFoundException('Leave not found');
    await this.prisma.scoped.doctorLeave.delete({ where: { id } });
  }

  // #1047 — Misafir doktor geliş penceresi CRUD (leave CRUD ikizi).
  async addVisitingWindow(input: VisitingWindowCreateInput) {
    await this.findById(input.doctorId);
    const tenantId = this.tenantContext.requireTenantId();
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    // Aynı doktorda örtüşen pencere reddi (half-open overlap).
    const overlap = await this.prisma.scoped.visitingWindow.findFirst({
      where: {
        doctorId: input.doctorId,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { id: true },
    });
    if (overlap) {
      throw new BadRequestException(
        'Bu doktor için seçilen tarihlerle örtüşen bir ziyaret penceresi zaten var.',
      );
    }
    return this.prisma.scoped.visitingWindow.create({
      data: {
        tenantId,
        doctorId: input.doctorId,
        startsAt,
        endsAt,
        notes: input.notes ?? null,
      },
    });
  }

  async listVisitingWindows({ doctorId, from }: VisitingWindowListQuery) {
    await this.findById(doctorId);
    const since = from ? new Date(from) : new Date();
    // Aktif + gelecek pencereler (yarısı geçmiş pencere hâlâ aktif sayılır).
    return this.prisma.scoped.visitingWindow.findMany({
      where: { doctorId, endsAt: { gt: since } },
      orderBy: { startsAt: 'asc' },
    });
  }

  async findVisitingWindowsInRange({ doctorId, dateFrom, dateTo }: VisitingWindowRangeQuery) {
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    return this.prisma.scoped.visitingWindow.findMany({
      where: {
        ...(doctorId ? { doctorId } : {}),
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
      include: { doctor: { select: { id: true, name: true } } },
      orderBy: { startsAt: 'asc' },
    });
  }

  async deleteVisitingWindow(id: string) {
    const window = await this.prisma.scoped.visitingWindow.findFirst({ where: { id } });
    if (!window) throw new NotFoundException('Visiting window not found');
    await this.prisma.scoped.visitingWindow.delete({ where: { id } });
  }

  // #1049 — Doktor profil fotoğrafı (clinic-logo deseni: 2MB, png/jpeg/webp,
  // svg YOK). Magic-byte doğrulamalı; eski foto best-effort silinir.
  async uploadPhoto(doctorId: string, input: { buffer: Buffer; mimeType: string }) {
    const doctor = await this.findById(doctorId);
    const mime = input.mimeType.toLowerCase();
    if (!PHOTO_MIMES.has(mime)) {
      throw new BadRequestException(`Unsupported photo mime type: ${input.mimeType}`);
    }
    if (input.buffer.length > PHOTO_MAX_BYTES) {
      throw new BadRequestException(
        `Photo too large (${input.buffer.length} bytes, max ${PHOTO_MAX_BYTES})`,
      );
    }
    if (!matchesMagicBytes(input.buffer, mime)) {
      throw new BadRequestException('Dosya içeriği beyan edilen türle eşleşmiyor');
    }
    const tenantId = this.tenantContext.requireTenantId();
    const key = this.storage.buildScopedKey(
      tenantId,
      `doctors/${doctorId}`,
      crypto.randomUUID(),
      mime,
    );
    await this.storage.saveBuffer(key, input.buffer);
    await this.prisma.scoped.doctor.update({ where: { id: doctorId }, data: { photoKey: key } });
    if (doctor.photoKey) await this.storage.remove(doctor.photoKey).catch(() => undefined);
    return { ok: true as const };
  }

  async servePhoto(doctorId: string): Promise<StreamableFile> {
    const doctor = await this.findById(doctorId);
    if (!doctor.photoKey || !(await this.storage.exists(doctor.photoKey))) {
      throw new NotFoundException('Doctor photo not found');
    }
    const ext = doctor.photoKey.slice(doctor.photoKey.lastIndexOf('.'));
    return new StreamableFile(this.storage.readStream(doctor.photoKey), {
      type: PHOTO_TYPE_BY_EXT[ext] ?? 'application/octet-stream',
    });
  }
}

const PHOTO_MAX_BYTES = 2 * 1024 * 1024; // 2MB
const PHOTO_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const PHOTO_TYPE_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

function assertNoOverlaps(slots: AvailabilitySlotInput[]): void {
  const byDay = new Map<number, AvailabilitySlotInput[]>();
  for (const s of slots) {
    const arr = byDay.get(s.dayOfWeek) ?? [];
    arr.push(s);
    byDay.set(s.dayOfWeek, arr);
  }
  for (const [day, daySlots] of byDay) {
    const sorted = [...daySlots].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startTime < sorted[i - 1].endTime) {
        throw new BadRequestException(`Overlapping availability slots on day ${day}`);
      }
    }
  }
}
