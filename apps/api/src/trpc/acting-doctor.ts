import type { NurseSessionService } from '../nurse-session/nurse-session.service';
import type { TrpcContext } from './trpc.context';

/**
 * S15 — "Acting doctor" çözümü (asistan hemşire akışı).
 *
 * Tek-rol hemşire aktif `NurseAssistanceSession` ile bir doktora asiste ediyorsa,
 * doktor-scope'lu OKUMA sorgularında (iş kuyruğu, hasta listesi/detayı) o doktorun
 * `User.id`'si "etkin doktor" olarak kullanılır → hemşire Dr. X'in kuyruğunu +
 * hastalarını görür. Hemşire değilse, doktor rolünü de taşıyorsa (karma rol) veya
 * aktif session yoksa `undefined` döner (mevcut davranış korunur).
 *
 * İşlem ATFI ayrı bir konudur ve bu fonksiyonu kullanmaz: hemşirenin yaptığı
 * mutation'lar `measured_by_id = hemşire` kalır; `AuditService` onBehalfOf'u
 * yine aktif session'dan türetip Dr. X'e bağlar.
 */
export async function resolveActingDoctorUserId(
  ctx: TrpcContext,
  nurseSessions: NurseSessionService,
): Promise<string | undefined> {
  const roles = ctx.user?.roles ?? [];
  if (!roles.includes('hemsire') || roles.includes('doktor')) return undefined;
  const active = await nurseSessions.getActiveForNurse(ctx.user!.sub);
  return active?.doctorUserId;
}
