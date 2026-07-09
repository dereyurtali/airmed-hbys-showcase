import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { ApiKeyModule } from './api-key/api-key.module';
import { AppointmentModule } from './appointment/appointment.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AutomationModule } from './automation/automation.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { ImpersonationBlockGuard } from './auth/guards/impersonation-block.guard';
import { PermissionGuard } from './auth/guards/permission.guard';
import { MaintenanceGuard } from './platform/maintenance/maintenance.guard';
import { BillingModule } from './billing/billing.module';
import { ClinicSettingsModule } from './clinic-settings/clinic-settings.module';
import { CommissionModule } from './commission/commission.module';
import { ConsentModule } from './consent/consent.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { FraudModule } from './fraud/fraud.module';
import { DoctorModule } from './doctor/doctor.module';
import { EncounterModule } from './encounter/encounter.module';
import { NotificationModule } from './notification/notification.module';
import { MeasurementOrderModule } from './measurement/measurement-order.module';
import { ExaminationModule } from './examination/examination.module';
import { ExternalModule } from './external/external.module';
import { HealthController } from './health/health.controller';
import { IcdModule } from './icd/icd.module';
import { IolModule } from './iol/iol.module';
import { LabModule } from './lab/lab.module';
import { LeadModule } from './lead/lead.module';
import { MeasurementModule } from './measurement/measurement.module';
import { MetricModule } from './metric/metric.module';
import { PatientModule } from './patient/patient.module';
import { PermissionMatrixModule } from './permission/permission.module';
import { PharmacyModule } from './pharmacy/pharmacy.module';
import { PhotoModule } from './photo/photo.module';
import { PostOpModule } from './post-op/post-op.module';
import { StaffDocumentModule } from './staff-document/staff-document.module';
import { PreOpModule } from './pre-op/pre-op.module';
import { ProcedureModule } from './procedure/procedure.module';
import { SurgeryModule } from './surgery/surgery.module';
import { AdminsModule } from './platform/admins/admins.module';
import { IpAllowlistModule } from './platform/ip-allowlist/ip-allowlist.module';
import { PlatformAuditModule } from './platform/audit/platform-audit.module';
import { PlatformAuthModule } from './platform/auth/platform-auth.module';
import { FeatureFlagsModule } from './platform/feature-flags/feature-flags.module';
import { PlatformFeedbackModule } from './platform/feedback/platform-feedback.module';
import { PlatformHealthModule } from './platform/health/platform-health.module';
import { PlatformSecurityModule } from './platform/security/platform-security.module';
import { PlatformMaintenanceModule } from './platform/maintenance/platform-maintenance.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { PlatformUsageModule } from './platform/usage/platform-usage.module';
import { PlatformAiModule } from './platform/ai/platform-ai.module';
import { PlatformSyncModule } from './platform/sync/platform-sync.module';
import { PlatformMetricsModule } from './platform/metrics/platform-metrics.module';
import { PlatformTenantsModule } from './platform/tenants/platform-tenants.module';
import { ImpersonationModule } from './platform/impersonation/impersonation.module';
import { SyncModule } from './sync/sync.module';
import { MessagingModule } from './messaging/messaging.module';
import { NurseSessionModule } from './nurse-session/nurse-session.module';
import { RecallModule } from './recall/recall.module';
import { PrismaModule } from './prisma/prisma.module';
import { SetupModule } from './setup/setup.module';
import { PublicMonitorModule } from './public-monitor/public-monitor.module';
import { StorageModule } from './storage/storage.module';
import { TasksModule } from './tasks/tasks.module';
import { AllExceptionsFilter } from './observability/all-exceptions.filter';
import { TenantInterceptor } from './tenant/tenant.interceptor';
import { TenantModule } from './tenant/tenant.module';
import { TrpcModule } from './trpc/trpc.module';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
    // A13 — nightly audit retention cleanup (180 gün). Test'te no-op kalır:
    // cron decorator NODE_ENV='test' iken bile çalışır ama tek tek e2e testler
    // app.close() ile process'i sonlandırdığı için fire etmez.
    ScheduleModule.forRoot(),
    // Default throttle: 100 req/min per IP across the app. Auth endpoints
    // tighten this with their own @Throttle({ default: ... }) overrides.
    // e2e tests fire many requests quickly; bump the cap there so the
    // throttle guard never becomes the test failure mode.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: process.env.NODE_ENV === 'test' ? 10_000 : 100,
        },
      ],
    }),
    TenantModule,
    PrismaModule,
    StorageModule,
    NurseSessionModule,
    AuditModule,
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
    LeadModule,
    ApiKeyModule,
    PhotoModule,
    StaffDocumentModule,
    PharmacyModule,
    MetricModule,
    SurgeryModule,
    PostOpModule,
    PreOpModule,
    ProcedureModule,
    CommissionModule,
    BillingModule,
    ConsentModule,
    FraudModule,
    // S14 — v0.1 port
    DashboardModule,
    PermissionMatrixModule,
    WebhookModule,
    EncounterModule,
    NotificationModule,
    MeasurementOrderModule,
    TasksModule,
    ExternalModule,
    TrpcModule,
    AdminsModule,
    IpAllowlistModule,
    PlatformAuditModule,
    PlatformAuthModule,
    PlatformTenantsModule,
    PlatformHealthModule,
    PlatformMetricsModule,
    PlatformSecurityModule,
    PlatformMaintenanceModule,
    AnnouncementsModule,
    PlatformUsageModule,
    PlatformAiModule,
    PlatformSyncModule,
    PlatformFeedbackModule,
    FeatureFlagsModule,
    ImpersonationModule,
    SyncModule,
    MessagingModule,
    RecallModule,
    SetupModule,
    PublicMonitorModule,
    ClinicSettingsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Throttle guard runs first (rate limit before any auth work). JwtAuthGuard
    // runs next and falls back to @Public() bypass.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // F4 — JwtAuthGuard'dan SONRA: req.user dolu, `@BlockImpersonation()` ile
    // işaretli endpoint'lerde JWT'deki `imp` claim'i 403 atar.
    {
      provide: APP_GUARD,
      useClass: ImpersonationBlockGuard,
    },
    // S3 — `@RequirePermission('action:...')` decorator'ı ile işaretli
    // endpoint'lerde permission registry kontrolü. RolesGuard ile aynı sırada
    // çalışıyor; mevcut @Roles + bu yeni @RequirePermission ikisi de bağımsız
    // metadata key kullanır. Migration tamamlandığında RolesGuard kaldırılır.
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
    // #1093 — Bakım guard: auth'tan SONRA (req.user tenant penceresi için dolu);
    // aktif bakım penceresinde klinik mutasyonlarını 503 + Retry-After ile reddeder.
    {
      provide: APP_GUARD,
      useClass: MaintenanceGuard,
    },
    // Tenant interceptor opens the per-request transaction; audit must run
    // inside it so the audit row is written via prisma.scoped (RLS-checked).
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    // Global REST exception filter — beklenmeyen hataları yakalar (log + Sentry),
    // istemciye iç detay sızdırmaz. HttpException body'leri aynen korunur.
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
