import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as trpcExpress from '@trpc/server/adapters/express';
import type { Request, Response, NextFunction } from 'express';
import { ApiKeyModule } from '../api-key/api-key.module';
import { ApiKeyService } from '../api-key/api-key.service';
import { AppointmentModule } from '../appointment/appointment.module';
import { AppointmentService } from '../appointment/appointment.service';
import { AvailabilityService } from '../appointment/availability.service';
import { AuditService } from '../audit/audit.service';
import { AutomationModule } from '../automation/automation.module';
import { AutomationAdminService } from '../automation/automation-admin.service';
import { StaffDocumentModule } from '../staff-document/staff-document.module';
import { StaffDocumentService } from '../staff-document/staff-document.service';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { BillingModule } from '../billing/billing.module';
import { DiscountApprovalService } from '../billing/approval/approval.service';
import { CashRegisterService } from '../billing/cash-register.service';
import { InvoiceService } from '../billing/invoice.service';
import { PaymentService } from '../billing/payment.service';
import { RatesService } from '../billing/rates.service';
import { RefundService } from '../billing/refund.service';
import { ServiceItemService } from '../billing/service-item.service';
import { ClinicSettingsModule } from '../clinic-settings/clinic-settings.module';
import { ClinicSettingsService } from '../clinic-settings/clinic-settings.service';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { CommissionModule } from '../commission/commission.module';
import { CommissionService } from '../commission/commission.service';
import { ConsentModule } from '../consent/consent.module';
import { ConsentService } from '../consent/consent.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AdminOverviewService } from '../dashboard/admin-overview.service';
import { RoleOverviewService } from '../dashboard/role-overview.service';
import { DashboardLayoutService } from '../dashboard/dashboard.service';
import { FraudModule } from '../fraud/fraud.module';
import { FraudDetectionService } from '../fraud/fraud.service';
import { DoctorModule } from '../doctor/doctor.module';
import { DoctorService } from '../doctor/doctor.service';
import { EncounterModule } from '../encounter/encounter.module';
import { EncounterService } from '../encounter/encounter.service';
import { ExaminationModule } from '../examination/examination.module';
import { ExaminationService } from '../examination/examination.service';
import { IcdModule } from '../icd/icd.module';
import { IcdService } from '../icd/icd.service';
import { IolModule } from '../iol/iol.module';
import { ConsumableModule } from '../consumable/consumable.module';
import { ConsumableService } from '../consumable/consumable.service';
import { ClinicalListModule } from '../clinical-list/clinical-list.module';
import { ClinicalListService } from '../clinical-list/clinical-list.service';
import { PurchaseOrderModule } from '../purchase-order/purchase-order.module';
import { PurchaseOrderService } from '../purchase-order/purchase-order.service';
import { AuditCosignService } from '../audit/audit-cosign.service';
import { IolForecastService } from '../iol/iol-forecast.service';
import { IolService } from '../iol/iol.service';
import { SurgicalKitService } from '../iol/surgical-kit.service';
import { LabModule } from '../lab/lab.module';
import { LabThresholdService } from '../lab/lab-threshold.service';
import { LabService } from '../lab/lab.service';
import { LeadModule } from '../lead/lead.module';
import { LeadService } from '../lead/lead.service';
import { MeasurementModule } from '../measurement/measurement.module';
import { MeasurementService } from '../measurement/measurement.service';
import { MeasurementOrderModule } from '../measurement/measurement-order.module';
import { MeasurementOrderService } from '../measurement/measurement-order.service';
import { MessagingModule } from '../messaging/messaging.module';
import { MessagingAdminService } from '../messaging/messaging.admin.service';
import { PatientThreadService } from '../messaging/patient-thread.service';
import { RecallModule } from '../recall/recall.module';
import { RecallService } from '../recall/recall.service';
import { MetricModule } from '../metric/metric.module';
import { MetricService } from '../metric/metric.service';
import { NotificationModule } from '../notification/notification.module';
import { NotificationService } from '../notification/notification.service';
import { PatientModule } from '../patient/patient.module';
import { PatientService } from '../patient/patient.service';
import { PermissionMatrixModule } from '../permission/permission.module';
import { PermissionMatrixService } from '../permission/permission.service';
import { DrugInteractionService } from '../pharmacy/drug-interaction.service';
import { PharmacyModule } from '../pharmacy/pharmacy.module';
import { PharmacyService } from '../pharmacy/pharmacy.service';
import { PharmacyRetailModule } from '../pharmacy-retail/pharmacy-retail.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { FeedbackService } from '../feedback/feedback.service';
import { PharmacyRetailService } from '../pharmacy-retail/pharmacy-retail.service';
import { PhotoModule } from '../photo/photo.module';
import { PhotoService } from '../photo/photo.service';
import { PostOpModule } from '../post-op/post-op.module';
import { PostOpService } from '../post-op/post-op.service';
import { PreOpModule } from '../pre-op/pre-op.module';
import { PreOpService } from '../pre-op/pre-op.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProcedureModule } from '../procedure/procedure.module';
import { ProcedureService } from '../procedure/procedure.service';
import { NurseSessionModule } from '../nurse-session/nurse-session.module';
import { NurseSessionService } from '../nurse-session/nurse-session.service';
import { SafetyChecklistService } from '../surgery/safety-checklist.service';
import { SurgeryModule } from '../surgery/surgery.module';
import { SurgeryService } from '../surgery/surgery.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { WebhookModule } from '../webhook/webhook.module';
import { WebhookService } from '../webhook/webhook.service';
import { captureException } from '../observability/sentry';
import { buildAppRouter } from './app-router';
import { createTrpcContextFactory } from './trpc.context';

@Module({
  imports: [
    AuthModule,
    PatientModule,
    DoctorModule,
    AppointmentModule,
    AutomationModule,
    ExaminationModule,
    MeasurementModule,
    IcdModule,
    LabModule,
    IolModule,
    ConsumableModule,
    ClinicalListModule,
    PurchaseOrderModule,
    LeadModule,
    ApiKeyModule,
    PhotoModule,
    PharmacyModule,
    PharmacyRetailModule,
    FeedbackModule,
    MetricModule,
    SurgeryModule,
    PostOpModule,
    ProcedureModule,
    PreOpModule,
    CommissionModule,
    ConsentModule,
    FraudModule,
    MessagingModule,
    BillingModule,
    DashboardModule,
    PermissionMatrixModule,
    WebhookModule,
    EncounterModule,
    NotificationModule,
    MeasurementOrderModule,
    NurseSessionModule,
    RecallModule,
    ClinicSettingsModule,
    UsersModule,
    StaffDocumentModule,
  ],
})
export class TrpcModule implements NestModule {
  constructor(
    private readonly auth: AuthService,
    private readonly patients: PatientService,
    private readonly doctors: DoctorService,
    private readonly appointments: AppointmentService,
    private readonly examinations: ExaminationService,
    private readonly measurements: MeasurementService,
    private readonly icd: IcdService,
    private readonly labs: LabService,
    private readonly labThresholds: LabThresholdService,
    private readonly iol: IolService,
    private readonly iolForecast: IolForecastService,
    private readonly surgicalKits: SurgicalKitService,
    private readonly consumables: ConsumableService,
    private readonly clinical: ClinicalListService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly cosign: AuditCosignService,
    private readonly leads: LeadService,
    private readonly apiKeys: ApiKeyService,
    private readonly photos: PhotoService,
    private readonly pharmacy: PharmacyService,
    private readonly drugInteractions: DrugInteractionService,
    private readonly pharmacyRetail: PharmacyRetailService,
    private readonly feedback: FeedbackService,
    private readonly metrics: MetricService,
    private readonly surgeries: SurgeryService,
    private readonly safetyChecklist: SafetyChecklistService,
    private readonly postOp: PostOpService,
    private readonly procedures: ProcedureService,
    private readonly preOp: PreOpService,
    private readonly commission: CommissionService,
    private readonly consent: ConsentService,
    private readonly fraud: FraudDetectionService,
    private readonly messagingAdmin: MessagingAdminService,
    private readonly patientThreads: PatientThreadService,
    private readonly recall: RecallService,
    private readonly serviceItems: ServiceItemService,
    private readonly invoices: InvoiceService,
    private readonly payments: PaymentService,
    private readonly refunds: RefundService,
    private readonly cashRegister: CashRegisterService,
    private readonly rates: RatesService,
    // S14 — v0.1 port
    private readonly approvals: DiscountApprovalService,
    private readonly dashboardLayout: DashboardLayoutService,
    private readonly adminOverview: AdminOverviewService,
    private readonly roleOverview: RoleOverviewService,
    private readonly permissionMatrix: PermissionMatrixService,
    private readonly webhooks: WebhookService,
    // S15 — Encounter (ziyaret akışı)
    private readonly encounters: EncounterService,
    // S15b — Notification (uygulama-içi bildirim)
    private readonly notifications: NotificationService,
    // S15c — Ölçüm sipariş akışı
    private readonly measurementOrders: MeasurementOrderService,
    // S15-PR10 — Hemşire Acting on Behalf
    private readonly nurseSessions: NurseSessionService,
    // S17 — Klinik bilgi (ad/adres/telefon/logo) yönetimi
    private readonly clinicSettings: ClinicSettingsService,
    // S17 — Klinik içi kullanıcı yönetimi (yönetici ekran)
    private readonly usersAdmin: UsersService,
    // #1019 — Boş-slot müsaitlik (takvim + AI hasta asistanı)
    private readonly availability: AvailabilityService,
    // EPIC #1018 — AI hasta asistanı yönetimi (#1020)
    private readonly automation: AutomationAdminService,
    // #1049 — personel dökümanları
    private readonly staffDocuments: StaffDocumentService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  configure(consumer: MiddlewareConsumer) {
    const router = buildAppRouter(
      this.auth,
      this.patients,
      this.doctors,
      this.appointments,
      this.examinations,
      this.measurements,
      this.icd,
      this.labs,
      this.labThresholds,
      this.iol,
      this.iolForecast,
      this.surgicalKits,
      this.consumables,
      this.clinical,
      this.purchaseOrders,
      this.cosign,
      this.leads,
      this.apiKeys,
      this.photos,
      this.pharmacy,
      this.drugInteractions,
      this.pharmacyRetail,
      this.feedback,
      this.metrics,
      this.surgeries,
      this.safetyChecklist,
      this.postOp,
      this.procedures,
      this.preOp,
      this.commission,
      this.consent,
      this.fraud,
      this.messagingAdmin,
      this.patientThreads,
      this.recall,
      {
        serviceItems: this.serviceItems,
        invoices: this.invoices,
        payments: this.payments,
        refunds: this.refunds,
        cashRegister: this.cashRegister,
        rates: this.rates,
      },
      // S14 — v0.1 port: approval, dashboard, permission, webhook
      this.approvals,
      this.dashboardLayout,
      this.adminOverview,
      this.roleOverview,
      this.permissionMatrix,
      this.webhooks,
      this.encounters,
      this.notifications,
      this.measurementOrders,
      this.nurseSessions,
      this.clinicSettings,
      this.usersAdmin,
      this.availability,
      this.automation,
      this.staffDocuments,
    );
    const createContext = createTrpcContextFactory(
      this.jwt,
      this.config,
      this.prisma,
      this.tenantContext,
      this.audit,
    );
    const handler = trpcExpress.createExpressMiddleware({
      router,
      createContext,
      // Beklenmeyen tRPC hatalarını (INTERNAL_SERVER_ERROR — error-mapper'ın
      // bilinen 4xx'e map edemediği gerçek çökmeler) Sentry'ye gönder. Bilinçli
      // 4xx'ler (CONFLICT/BAD_REQUEST/FORBIDDEN...) yakalanmaz, gürültü olmaz.
      onError: ({ error, path, type }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          captureException(error.cause ?? error, { trpcPath: path ?? null, type });
        }
      },
    });

    consumer
      .apply((req: Request, res: Response, next: NextFunction) => handler(req, res, next))
      .forRoutes({ path: 'trpc/*path', method: RequestMethod.ALL });
  }
}
