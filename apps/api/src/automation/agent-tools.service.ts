import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { AgentChannel } from '@airmed/db';
import { AppointmentService } from '../appointment/appointment.service';
import { AvailabilityService } from '../appointment/availability.service';
import { DoctorService, type DoctorBio } from '../doctor/doctor.service';
import { PatientService } from '../patient/patient.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AgentToolCall, AgentToolDefinition, ToolExecutionResult } from './model-provider';

// EPIC #1018 / #1021 — Agent tool'ları. HEPSİ doğrudan service katmanı:
// tenant scope (CLS tx — orkestratör her çağrıyı runWithTenant'a sarar),
// iş kuralları (çakışma EXCLUDE, mesai/izin assert'leri) ve audit bedavaya
// gelir. Servis hataları isError olarak modele döner — model alternatif
// önerir ("o saat dolu" → başka slot).
//
// Not: tool input'ları MODEL üretimidir; zod safeParse zorunlu, ham güven yok.

export interface AgentToolTrace {
  name: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
}

export interface ToolContext {
  tenantId: string;
  conversation: {
    id: string;
    channel: AgentChannel;
    contactPhone: string | null;
    patientId: string | null;
  };
  trace: AgentToolTrace[];
  handoff: { requested: boolean; reason: string };
}

const isoDateTime = z.string().datetime({ offset: true });

const freeSlotsInput = z.object({
  doctorId: z.string().uuid().optional(),
  dateFrom: isoDateTime,
  dateTo: isoDateTime,
  durationMinutes: z.number().int().multipleOf(5).min(5).max(240).optional(),
});

const findOrCreatePatientInput = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(['male', 'female', 'other']),
  phone: z.string().min(4).max(20).optional(),
});

const createAppointmentInput = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  startsAt: isoDateTime,
  durationMinutes: z.number().int().multipleOf(5).min(5).max(240).default(15),
  type: z.enum(['consultation', 'control']).default('consultation'),
  notes: z.string().max(500).optional(),
});

const handoffInput = z.object({ reason: z.string().min(1).max(500) });

// Kanal → LeadFunnel kaynak eşlemesi (E1 raporları randevunun nereden
// geldiğini görsün).
const LEAD_SOURCE_BY_CHANNEL: Record<
  AgentChannel,
  'whatsapp' | 'instagram' | 'telegram' | 'other'
> = {
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  telegram: 'telegram',
  facebook: 'other',
  webchat: 'other',
  other: 'other',
};

@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);

  constructor(
    private readonly availability: AvailabilityService,
    private readonly appointments: AppointmentService,
    private readonly patients: PatientService,
    private readonly doctors: DoctorService,
    private readonly prisma: PrismaService,
  ) {}

  definitions(): AgentToolDefinition[] {
    return [
      {
        name: 'doktor_listesi',
        description:
          'Klinikteki aktif doktorları (ad, uzmanlık, tip) listeler. Hastaya doktor ' +
          'önermeden veya uzman eşleştirmeden ÖNCE mutlaka çağır — doktor adı/uzmanlığı uydurma.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        readOnly: true,
      },
      {
        name: 'musaitlik_sorgula',
        description:
          'Doktorun (veya doctorId verilmezse tüm doktorların) boş randevu saatlerini döndürür. ' +
          'Hastaya saat önermeden ÖNCE mutlaka çağır — asla saat uydurma. Tarihler ISO 8601 ' +
          '(+05:00 Duşanbe). Yarından itibaren sorgula.',
        inputSchema: {
          type: 'object',
          properties: {
            doctorId: { type: 'string', description: 'Doktor UUID (doktor_listesi çıktısından)' },
            dateFrom: { type: 'string', description: 'Aralık başı, ISO 8601' },
            dateTo: { type: 'string', description: 'Aralık sonu, ISO 8601 (en fazla 31 gün)' },
            durationMinutes: { type: 'number', description: 'Slot süresi dk (varsayılan 15)' },
          },
          required: ['dateFrom', 'dateTo'],
          additionalProperties: false,
        },
        readOnly: true,
      },
      {
        name: 'hasta_bul_veya_olustur',
        description:
          'Hastayı telefon numarasıyla sistemde arar; yoksa yeni kayıt açar. Randevu ' +
          'oluşturmadan ÖNCE mutlaka çağır — randevu_olustur patientId ister. Hasta ' +
          'bilgilerini (ad, soyad, doğum tarihi) hastadan aldıktan sonra kullan. ' +
          'Doğum tarihini YYYY-MM-DD formatına kendin çevir. Cinsiyeti isimden çıkar, hastaya sorma.',
        inputSchema: {
          type: 'object',
          properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            birthDate: { type: 'string', description: 'YYYY-MM-DD' },
            gender: { type: 'string', enum: ['male', 'female', 'other'] },
            phone: {
              type: 'string',
              description: 'Verilmezse konuşmanın WhatsApp/kanal numarası kullanılır',
            },
          },
          required: ['firstName', 'lastName', 'birthDate', 'gender'],
          additionalProperties: false,
        },
      },
      {
        name: 'randevu_olustur',
        description:
          'Randevuyu HBYS takvimine KESİN olarak kaydeder. YALNIZ hasta saati açıkça ' +
          'onayladıktan ve hasta_bul_veya_olustur ile patientId alındıktan sonra çağır. ' +
          'Saat doluysa hata döner — musaitlik_sorgula ile alternatif öner.',
        inputSchema: {
          type: 'object',
          properties: {
            patientId: { type: 'string', description: 'hasta_bul_veya_olustur çıktısındaki UUID' },
            doctorId: { type: 'string', description: 'Doktor UUID' },
            startsAt: { type: 'string', description: 'ISO 8601, musaitlik_sorgula çıktısından' },
            durationMinutes: { type: 'number', description: 'Varsayılan 15' },
            type: {
              type: 'string',
              enum: ['consultation', 'control'],
              description: 'Varsayılan consultation',
            },
            notes: { type: 'string', description: 'Hastanın şikâyeti / kısa not' },
          },
          required: ['patientId', 'doctorId', 'startsAt'],
          additionalProperties: false,
        },
      },
      {
        name: 'insana_devret',
        description:
          'Konuşmayı klinik personeline devreder. Şu durumlarda MUTLAKA çağır: tıbbi tavsiye/teşhis ' +
          'istenirse, şikâyet/acil durum varsa, iki denemede çözemediğin bir talep varsa, hasta ' +
          'insanla görüşmek isterse. Çağırdıktan sonra hastaya kısa bir "görevliye aktarıyorum" mesajı yaz.',
        inputSchema: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Devir gerekçesi (personel görür)' },
          },
          required: ['reason'],
          additionalProperties: false,
        },
      },
    ];
  }

  // Orkestratör her çağrıyı tenant-scoped tx içinde çalıştırır (CLS).
  async execute(ctx: ToolContext, call: AgentToolCall): Promise<ToolExecutionResult> {
    const result = await this.dispatch(ctx, call).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`tool ${call.name} failed: ${message}`);
      return { output: message, isError: true } satisfies ToolExecutionResult;
    });
    ctx.trace.push({
      name: call.name,
      input: call.input,
      output: result.output.slice(0, 2000),
      isError: result.isError ?? false,
    });
    return result;
  }

  private async dispatch(ctx: ToolContext, call: AgentToolCall): Promise<ToolExecutionResult> {
    switch (call.name) {
      case 'doktor_listesi':
        return this.listDoctors();
      case 'musaitlik_sorgula':
        return this.freeSlots(call.input);
      case 'hasta_bul_veya_olustur':
        return this.findOrCreatePatient(ctx, call.input);
      case 'randevu_olustur':
        return this.createAppointment(ctx, call.input);
      case 'insana_devret':
        return this.handoff(ctx, call.input);
      default:
        return { output: `Bilinmeyen tool: ${call.name}`, isError: true };
    }
  }

  private async listDoctors(): Promise<ToolExecutionResult> {
    const { items } = await this.doctors.list({ isActive: true, page: 1, pageSize: 50 });
    if (items.length === 0) return { output: 'Kayıtlı aktif doktor yok.' };
    // #1051 — hasta-facing tanıtım YALNIZ publicProfile=true doktorda: unvan +
    // bio + diller. KVKK: CV/döküman (StaffDocument) verisi bota ASLA gitmez;
    // yayın-dışı doktor bugünkü gibi yalnız ad/uzmanlık/tip döner.
    const lines = items.map((d) => {
      let line = `- ${d.name} | uzmanlık: ${d.specialty} | tip: ${d.type} | doctorId: ${d.id}`;
      if (d.publicProfile) {
        if (d.title) line += ` | unvan: ${d.title}`;
        const bioText = pickBio(d.bio);
        if (bioText) line += ` | tanıtım: ${bioText}`;
        if (d.languages.length > 0) line += ` | konuştuğu diller: ${d.languages.join(', ')}`;
      }
      return line;
    });
    return { output: lines.join('\n') };
  }

  private async freeSlots(rawInput: Record<string, unknown>): Promise<ToolExecutionResult> {
    const parsed = freeSlotsInput.safeParse(rawInput);
    if (!parsed.success) return zodError(parsed.error);
    const { doctors } = await this.availability.freeSlots({
      doctorId: parsed.data.doctorId,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      durationMinutes: parsed.data.durationMinutes ?? 15,
    });
    const withSlots = doctors.filter((d) => d.slots.length > 0);
    if (withSlots.length === 0) {
      return { output: 'Bu aralıkta boş slot yok. Farklı bir tarih aralığı dene.' };
    }
    const lines = withSlots.map((d) => {
      const shown = d.slots.slice(0, 12).map(formatDushanbe).join(', ');
      const more = d.slots.length > 12 ? ` (+${d.slots.length - 12} slot daha)` : '';
      return `- ${d.name} (${d.specialty}) [doctorId: ${d.doctorId}]:\n  ${shown}${more}`;
    });
    return {
      output: `Boş slotlar (Duşanbe saati):\n${lines.join('\n')}\n(randevu_olustur'a slotun ISO karşılığını ver: örn ${withSlots[0].slots[0]})`,
    };
  }

  private async findOrCreatePatient(
    ctx: ToolContext,
    rawInput: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const parsed = findOrCreatePatientInput.safeParse(rawInput);
    if (!parsed.success) return zodError(parsed.error);
    const phone = parsed.data.phone ?? ctx.conversation.contactPhone;
    if (!phone) {
      return {
        output: 'Telefon numarası yok — hastadan telefon numarasını iste ve phone alanında gönder.',
        isError: true,
      };
    }

    const existing = await this.prisma.scoped.patient.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true, mrn: true, firstName: true, lastName: true },
    });
    if (existing) {
      await this.linkPatient(ctx, existing.id);
      await this.logAction(ctx, 'patient_matched', existing.id, `Telefonla eşleşti: ${phone}`);
      return {
        output: `Mevcut hasta bulundu: ${existing.firstName} ${existing.lastName} (MRN ${existing.mrn}). patientId: ${existing.id}`,
      };
    }

    const created = await this.patients.create(
      {
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        birthDate: parsed.data.birthDate,
        gender: parsed.data.gender,
        phone,
        leadSource: LEAD_SOURCE_BY_CHANNEL[ctx.conversation.channel],
        leadSourceNote: 'AI hasta asistanı',
      },
      // Ad+doğum tarihi benzerliği ConflictException atmasın — telefon zaten
      // birebir arandı; farklı numara = yeni kayıt kabulü (resepsiyon birleştirir).
      true,
      null,
    );
    await this.linkPatient(ctx, created.id);
    await this.logAction(
      ctx,
      'patient_created',
      created.id,
      `Yeni hasta: ${created.firstName} ${created.lastName} (${phone})`,
    );
    return {
      output: `Yeni hasta kaydı açıldı: ${created.firstName} ${created.lastName} (MRN ${created.mrn}). patientId: ${created.id}`,
    };
  }

  private async createAppointment(
    ctx: ToolContext,
    rawInput: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const parsed = createAppointmentInput.safeParse(rawInput);
    if (!parsed.success) return zodError(parsed.error);
    const startsAt = new Date(parsed.data.startsAt);
    const endsAt = new Date(startsAt.getTime() + parsed.data.durationMinutes * 60 * 1000);

    const created = await this.appointments.create({
      patientId: parsed.data.patientId,
      doctorId: parsed.data.doctorId,
      type: parsed.data.type,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      notes: parsed.data.notes ?? null,
      source: LEAD_SOURCE_BY_CHANNEL[ctx.conversation.channel],
    });
    await this.logAction(
      ctx,
      'appointment_created',
      created.id,
      `Randevu: ${formatDushanbe(startsAt.toISOString())} (${parsed.data.type})`,
      { input: parsed.data },
    );
    return {
      output: `Randevu oluşturuldu: ${formatDushanbe(startsAt.toISOString())} Duşanbe saati. appointmentId: ${created.id}`,
    };
  }

  private async handoff(
    ctx: ToolContext,
    rawInput: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const parsed = handoffInput.safeParse(rawInput);
    if (!parsed.success) return zodError(parsed.error);
    ctx.handoff.requested = true;
    ctx.handoff.reason = parsed.data.reason;
    await this.logAction(ctx, 'handoff', null, `Devir: ${parsed.data.reason}`);
    return {
      output:
        'Devir kaydedildi — personel bilgilendirilecek. Hastaya kısa bir aktarım mesajı yaz ve başka aksiyon alma.',
    };
  }

  private async linkPatient(ctx: ToolContext, patientId: string): Promise<void> {
    if (ctx.conversation.patientId === patientId) return;
    await this.prisma.scoped.agentConversation.update({
      where: { id: ctx.conversation.id },
      data: { patientId },
    });
    ctx.conversation.patientId = patientId;
  }

  private async logAction(
    ctx: ToolContext,
    type:
      | 'appointment_created'
      | 'appointment_cancelled'
      | 'patient_created'
      | 'patient_matched'
      | 'handoff'
      | 'error',
    refId: string | null,
    summary: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.scoped.agentAction.create({
      data: {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversation.id,
        type,
        refId,
        summary: summary.slice(0, 500),
        // Model input'u serbest şekilli — JSON-güvenli hale getirip yaz.
        payload: payload ? JSON.parse(JSON.stringify(payload)) : undefined,
      },
    });
  }
}

// #1051 — bio çok-dilli; bot konuşma dilini kendi yönetir → ilk dolu metni
// TR→RU→TG sırasıyla ver, LLM konuşma diline uyarlar.
function pickBio(bio: DoctorBio | null): string | null {
  if (!bio) return null;
  const text = bio.tr?.trim() || bio.ru?.trim() || bio.tg?.trim();
  return text && text.length > 0 ? text : null;
}

function zodError(error: z.ZodError): ToolExecutionResult {
  const detail = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  return { output: `Geçersiz tool input: ${detail}`, isError: true };
}

// Duşanbe UTC+5 (DST yok) — appointment.service formatTrDate ile aynı yöntem.
function formatDushanbe(iso: string): string {
  const local = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  const dd = String(local.getUTCDate()).padStart(2, '0');
  const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mi = String(local.getUTCMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${local.getUTCFullYear()} ${hh}:${mi}`;
}
