import { ApiKeyService } from '../api-key/api-key.service';
import { AppointmentService } from '../appointment/appointment.service';
import { AvailabilityService } from '../appointment/availability.service';
import { AuthService } from '../auth/auth.service';
import { AutomationAdminService } from '../automation/automation-admin.service';
import { StaffDocumentService } from '../staff-document/staff-document.service';
import { DiscountApprovalService } from '../billing/approval/approval.service';
import { CashRegisterService } from '../billing/cash-register.service';
import { InvoiceService } from '../billing/invoice.service';
import { PaymentService } from '../billing/payment.service';
import { RatesService } from '../billing/rates.service';
import { RefundService } from '../billing/refund.service';
import { ServiceItemService } from '../billing/service-item.service';
import { ClinicSettingsService } from '../clinic-settings/clinic-settings.service';
import { CommissionService } from '../commission/commission.service';
import { ConsentService } from '../consent/consent.service';
import { AdminOverviewService } from '../dashboard/admin-overview.service';
import { RoleOverviewService } from '../dashboard/role-overview.service';
import { DashboardLayoutService } from '../dashboard/dashboard.service';
import { FraudDetectionService } from '../fraud/fraud.service';
import { DoctorService } from '../doctor/doctor.service';
import { EncounterService } from '../encounter/encounter.service';
import { ExaminationService } from '../examination/examination.service';
import { IcdService } from '../icd/icd.service';
import { AuditCosignService } from '../audit/audit-cosign.service';
import { IolForecastService } from '../iol/iol-forecast.service';
import { IolService } from '../iol/iol.service';
import { SurgicalKitService } from '../iol/surgical-kit.service';
import { ConsumableService } from '../consumable/consumable.service';
import { ClinicalListService } from '../clinical-list/clinical-list.service';
import { PurchaseOrderService } from '../purchase-order/purchase-order.service';
import { LabThresholdService } from '../lab/lab-threshold.service';
import { LabService } from '../lab/lab.service';
import { LeadService } from '../lead/lead.service';
import { MeasurementService } from '../measurement/measurement.service';
import { MeasurementOrderService } from '../measurement/measurement-order.service';
import { MessagingAdminService } from '../messaging/messaging.admin.service';
import { PatientThreadService } from '../messaging/patient-thread.service';
import { RecallService } from '../recall/recall.service';
import { MetricService } from '../metric/metric.service';
import { NotificationService } from '../notification/notification.service';
import { PatientService } from '../patient/patient.service';
import { PermissionMatrixService } from '../permission/permission.service';
import { DrugInteractionService } from '../pharmacy/drug-interaction.service';
import { PharmacyService } from '../pharmacy/pharmacy.service';
import { PharmacyRetailService } from '../pharmacy-retail/pharmacy-retail.service';
import { FeedbackService } from '../feedback/feedback.service';
import { PhotoService } from '../photo/photo.service';
import { PostOpService } from '../post-op/post-op.service';
import { PreOpService } from '../pre-op/pre-op.service';
import { ProcedureService } from '../procedure/procedure.service';
import { NurseSessionService } from '../nurse-session/nurse-session.service';
import { SafetyChecklistService } from '../surgery/safety-checklist.service';
import { SurgeryService } from '../surgery/surgery.service';
import { WebhookService } from '../webhook/webhook.service';
import { apiKeyRouterFactory } from './routers/api-key.router';
import { approvalRouterFactory } from './routers/approval.router';
import { appointmentRouterFactory } from './routers/appointment.router';
import { authRouterFactory } from './routers/auth.router';
import { automationRouterFactory } from './routers/automation.router';
import { staffDocumentRouterFactory } from './routers/staff-document.router';
import { availabilityRouterFactory } from './routers/availability.router';
import { billingRouterFactory } from './routers/billing.router';
import { commissionRouterFactory } from './routers/commission.router';
import { consentRouterFactory } from './routers/consent.router';
import { dashboardRouterFactory } from './routers/dashboard.router';
import { encounterRouterFactory } from './routers/encounter.router';
import { fraudRouterFactory } from './routers/fraud.router';
import { doctorRouterFactory } from './routers/doctor.router';
import { examinationRouterFactory } from './routers/examination.router';
import { icdRouterFactory } from './routers/icd.router';
import { iolRouterFactory } from './routers/iol.router';
import { consumableRouterFactory } from './routers/consumable.router';
import { clinicalListRouterFactory } from './routers/clinical-list.router';
import { purchaseOrderRouterFactory } from './routers/purchase-order.router';
import { labRouterFactory } from './routers/lab.router';
import { leadRouterFactory } from './routers/lead.router';
import { measurementRouterFactory } from './routers/measurement.router';
import { measurementOrderRouterFactory } from './routers/measurement-order.router';
import { cosignRouterFactory } from './routers/cosign.router';
import { messagingRouterFactory } from './routers/messaging.router';
import { recallRouterFactory } from './routers/recall.router';
import { clinicSettingsRouterFactory } from './routers/clinic-settings.router';
import { metricRouterFactory } from './routers/metric.router';
import { notificationRouterFactory } from './routers/notification.router';
import { patientRouterFactory } from './routers/patient.router';
import { permissionRouterFactory } from './routers/permission.router';
import { pharmacyRouterFactory } from './routers/pharmacy.router';
import { pharmacyRetailRouterFactory } from './routers/pharmacy-retail.router';
import { feedbackRouterFactory } from './routers/feedback.router';
import { photoRouterFactory } from './routers/photo.router';
import { postOpRouterFactory } from './routers/post-op.router';
import { preOpRouterFactory } from './routers/pre-op.router';
import { procedureRouterFactory } from './routers/procedure.router';
import { surgeryRouterFactory } from './routers/surgery.router';
import { nurseSessionRouterFactory } from './routers/nurse-session.router';
import { userRouterFactory } from './routers/user.router';
import { userAdminRouterFactory } from './routers/user-admin.router';
import { UsersService } from '../users/users.service';
import { webhookRouterFactory } from './routers/webhook.router';
import { router } from './trpc';

export const buildAppRouter = (
  auth: AuthService,
  patients: PatientService,
  doctors: DoctorService,
  appointments: AppointmentService,
  examinations: ExaminationService,
  measurements: MeasurementService,
  icd: IcdService,
  labs: LabService,
  labThresholds: LabThresholdService,
  iol: IolService,
  iolForecast: IolForecastService,
  surgicalKits: SurgicalKitService,
  consumables: ConsumableService,
  clinical: ClinicalListService,
  purchaseOrders: PurchaseOrderService,
  cosign: AuditCosignService,
  leads: LeadService,
  apiKeys: ApiKeyService,
  photos: PhotoService,
  pharmacy: PharmacyService,
  drugInteractions: DrugInteractionService,
  pharmacyRetail: PharmacyRetailService,
  feedback: FeedbackService,
  metrics: MetricService,
  surgeries: SurgeryService,
  safetyChecklist: SafetyChecklistService,
  postOp: PostOpService,
  procedures: ProcedureService,
  preOp: PreOpService,
  commission: CommissionService,
  consent: ConsentService,
  fraud: FraudDetectionService,
  messagingAdmin: MessagingAdminService,
  patientThreads: PatientThreadService,
  recall: RecallService,
  billing: {
    serviceItems: ServiceItemService;
    invoices: InvoiceService;
    payments: PaymentService;
    refunds: RefundService;
    cashRegister: CashRegisterService;
    rates: RatesService;
  },
  // S14 — v0.1 port: indirim onayı, dashboard layout, permission matrix, webhook
  approvals: DiscountApprovalService,
  dashboard: DashboardLayoutService,
  adminOverview: AdminOverviewService,
  roleOverview: RoleOverviewService,
  permissions: PermissionMatrixService,
  webhooks: WebhookService,
  // S15 — Encounter (ziyaret akışı / istasyon yolculuğu)
  encounters: EncounterService,
  // S15b — Notification (uygulama-içi bildirim)
  notifications: NotificationService,
  // S15c — Ölçüm sipariş akışı
  measurementOrders: MeasurementOrderService,
  // S15-PR10 — Hemşire Acting on Behalf
  nurseSessions: NurseSessionService,
  // S17 — Klinik bilgi (ad/adres/telefon/logo) yönetimi
  clinicSettings: ClinicSettingsService,
  // S17 — Klinik içi kullanıcı yönetimi (yönetici ekran)
  usersAdmin: UsersService,
  // #1019 — Boş-slot müsaitlik (takvim + AI hasta asistanı)
  availability: AvailabilityService,
  // EPIC #1018 — AI hasta asistanı yönetimi (#1020)
  automation: AutomationAdminService,
  // #1049 — personel dökümanları (metadata listesi; upload/serve REST'te)
  staffDocuments: StaffDocumentService,
) =>
  router({
    auth: authRouterFactory(auth),
    patient: patientRouterFactory(patients, nurseSessions),
    doctor: doctorRouterFactory(doctors),
    appointment: appointmentRouterFactory(appointments),
    examination: examinationRouterFactory(examinations),
    measurement: measurementRouterFactory(measurements),
    icd: icdRouterFactory(icd),
    lab: labRouterFactory(labs, labThresholds),
    iol: iolRouterFactory(iol, iolForecast, surgicalKits),
    consumable: consumableRouterFactory(consumables),
    clinicalList: clinicalListRouterFactory(clinical),
    purchaseOrder: purchaseOrderRouterFactory(purchaseOrders),
    lead: leadRouterFactory(leads),
    apiKey: apiKeyRouterFactory(apiKeys),
    photo: photoRouterFactory(photos),
    pharmacy: pharmacyRouterFactory(pharmacy, drugInteractions),
    pharmacyRetail: pharmacyRetailRouterFactory(pharmacyRetail),
    feedback: feedbackRouterFactory(feedback),
    metric: metricRouterFactory(metrics),
    surgery: surgeryRouterFactory(surgeries, safetyChecklist),
    postOp: postOpRouterFactory(postOp),
    procedure: procedureRouterFactory(procedures),
    preOp: preOpRouterFactory(preOp),
    commission: commissionRouterFactory(commission),
    consent: consentRouterFactory(consent),
    fraud: fraudRouterFactory(fraud),
    messaging: messagingRouterFactory(messagingAdmin, patientThreads),
    recall: recallRouterFactory(recall),
    cosign: cosignRouterFactory(cosign),
    user: userRouterFactory(),
    nurseSession: nurseSessionRouterFactory(nurseSessions),
    billing: billingRouterFactory(billing),
    // S14
    approval: approvalRouterFactory(approvals),
    dashboard: dashboardRouterFactory(dashboard, adminOverview, roleOverview),
    permission: permissionRouterFactory(permissions),
    webhook: webhookRouterFactory(webhooks),
    // S15 — Encounter (ziyaret akışı)
    encounter: encounterRouterFactory(encounters, nurseSessions),
    // S15b — Notification (uygulama-içi bildirim)
    notification: notificationRouterFactory(notifications),
    // S15c — Ölçüm sipariş akışı
    measurementOrder: measurementOrderRouterFactory(measurementOrders, nurseSessions),
    // S17 — Klinik bilgi yönetimi
    clinicSettings: clinicSettingsRouterFactory(clinicSettings),
    // S17 — Klinik içi kullanıcı yönetimi (yönetici ekran)
    userAdmin: userAdminRouterFactory(usersAdmin),
    // #1019 — Boş-slot müsaitlik (takvim + AI hasta asistanı)
    availability: availabilityRouterFactory(availability),
    // EPIC #1018 — AI hasta asistanı yönetimi (#1020)
    automation: automationRouterFactory(automation),
    // #1049 — personel dökümanları
    staffDocument: staffDocumentRouterFactory(staffDocuments),
  });

export type AppRouter = ReturnType<typeof buildAppRouter>;
