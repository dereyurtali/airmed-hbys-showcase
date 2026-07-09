import { Injectable } from '@nestjs/common';
import { hasPermission } from '@airmed/contracts';
import { AppointmentService } from '../appointment/appointment.service';
import { AuditCosignService } from '../audit/audit-cosign.service';
import { EncounterService } from '../encounter/encounter.service';
import { RecallService } from '../recall/recall.service';
import { SurgeryService } from '../surgery/surgery.service';

interface OverviewActor {
  id: string;
  roles: readonly string[];
  effectivePerms?: readonly string[];
}

interface DayRange {
  dateFrom: string;
  dateTo: string;
}

// #1066 — Rol Genel Bakış agregatları (adminOverview deseni). Doctor/Nurse
// overview ekranları eskiden 4-5 bağımsız 60sn poll başlatıyordu (ekran başına
// timer + render churn'ü); artık tek endpoint + tek timer. İzin gerektiren
// parçalar (cosign/recall) aktörün iznine göre koşullu boş döner — endpoint
// yetki YÜKSELTMEZ, yalnız izinli parçaları doldurur.
@Injectable()
export class RoleOverviewService {
  constructor(
    private readonly encounters: EncounterService,
    private readonly appointments: AppointmentService,
    private readonly cosign: AuditCosignService,
    private readonly surgeries: SurgeryService,
    private readonly recall: RecallService,
  ) {}

  async doctorOverview(actor: OverviewActor, range: DayRange) {
    const canCosign = hasPermission(actor.roles, 'action:audit.cosign', actor.effectivePerms);
    const [worklist, appointments, cosignPending, surgeries] = await Promise.all([
      this.encounters.findMyWorklist(actor.id, {}),
      this.appointments.findInRange({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
      canCosign ? this.cosign.listPendingForDoctor(actor.id) : Promise.resolve([]),
      this.surgeries.list({
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        page: 1,
        pageSize: 20,
      }),
    ]);
    return { worklist, appointments, cosignPending, surgeries };
  }

  async nurseOverview(actor: OverviewActor, range: DayRange) {
    const canRecall = hasPermission(actor.roles, 'action:recall.list', actor.effectivePerms);
    const [recallMissed, recallToday, surgeries] = await Promise.all([
      canRecall ? this.recall.listForBucket({ bucket: 'missed', limit: 100 }) : Promise.resolve([]),
      canRecall ? this.recall.listForBucket({ bucket: 'today', limit: 100 }) : Promise.resolve([]),
      this.surgeries.list({
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        page: 1,
        pageSize: 20,
      }),
    ]);
    return { recallMissed, recallToday, surgeries };
  }
}
