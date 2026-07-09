import { ClinicSettingsService } from '../../clinic-settings/clinic-settings.service';
import { clinicSettingsUpdateSchema } from '../../clinic-settings/clinic-settings.schemas';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// S17 — Klinik bilgi (ad, adres, telefon, e-posta, logo, tax) yönetim router'ı.
// get: tenant kapsamında authenticated her kullanıcı (klinik adı topbar/
// fatura header'ı için). update: yalnız `action:clinicSettings.update`
// (yönetici).
export const clinicSettingsRouterFactory = (svc: ClinicSettingsService) =>
  router({
    get: protectedProcedure.query(() => svc.get()),
    update: permissionProcedure('action:clinicSettings.update')
      .input(clinicSettingsUpdateSchema)
      .mutation(({ input, ctx }) => svc.update(input, { roles: ctx.user!.roles })),
    // #1159 — Lobi bekleme ekranı yayın anahtarı (Raspberry Pi kiosk).
    publicMonitorStatus: permissionProcedure('action:clinicSettings.update').query(() =>
      svc.getPublicMonitorStatus(),
    ),
    generatePublicMonitorKey: permissionProcedure('action:clinicSettings.update').mutation(
      ({ ctx }) => svc.generatePublicMonitorKey({ roles: ctx.user!.roles }),
    ),
    disablePublicMonitorKey: permissionProcedure('action:clinicSettings.update').mutation(
      ({ ctx }) => svc.disablePublicMonitorKey({ roles: ctx.user!.roles }),
    ),
  });
