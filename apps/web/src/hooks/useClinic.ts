import { trpc } from '../lib/trpc';
import type { WorkingHours } from '../lib/schedule.utils';
import { useAuth } from '../providers/AuthProvider';

/**
 * Klinik bilgileri (ad + logo) — Ayarlar > Klinik Ayarları sayfasından yönetici
 * tarafından girilir. Sidebar, header, tarayıcı sekmesi vb. yerlerde dinamik
 * marka kaynağı. trpc query cache'lenir (5 dk staleTime), yönetici güncelleme
 * yaparsa `utils.clinicSettings.get.invalidate()` ile yenilenir.
 *
 * Auth olmayan kullanıcı için query disabled (login öncesi tenant bilgisi yok).
 */
export function useClinic() {
  const { isAuthenticated } = useAuth();
  const query = trpc.clinicSettings.get.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
  return {
    name: query.data?.name ?? null,
    logoUrl: query.data?.logoUrl ?? null,
    // Madde 1+4 — randevu planlama ayarları (yönetici Klinik Ayarları'ndan girer).
    defaultAppointmentMinutes:
      (query.data as { scheduling?: { defaultAppointmentMinutes?: number | null } } | undefined)
        ?.scheduling?.defaultAppointmentMinutes ?? null,
    postOpFreeMonths:
      (query.data as { scheduling?: { postOpFreeMonths?: number | null } } | undefined)?.scheduling
        ?.postOpFreeMonths ?? null,
    // #1048 — klinik mesai penceresi; takvim grid saat aralığı bundan türer.
    workingHours:
      (query.data as { scheduling?: { workingHours?: WorkingHours | null } } | undefined)
        ?.scheduling?.workingHours ?? null,
    isLoading: query.isLoading,
  };
}
