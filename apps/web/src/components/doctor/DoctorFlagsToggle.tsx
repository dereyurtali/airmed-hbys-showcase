import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { trpc } from '../../lib/trpc';

interface DoctorFlagsToggleProps {
  doctorId: string;
}

/**
 * S8b — Yönetici tarafından doktor user flag'lerini düzenleme paneli
 * (karar tutanağı §3 + §7.4-5).
 *
 * `can_see_all_patients`: baş hekim için sıkı izolasyon kaldırılır
 *  (doktor tüm tenant hastalarını görür).
 * `is_visiting_doctor`: misafir cerrah; sadece kendi yaptığı cerrahileri görür
 *  (PatientDoctor m2m bypass; daha kısıtlayıcı, can_see_all_patients'i override).
 *
 * Mutation success sonrası flag güncellenir; ama JWT cache'lendiği için
 * doktor user'ın yeni token alması (logout/login veya refresh) gerek; uyarı
 * gösterilir.
 */
export function DoctorFlagsToggle({ doctorId }: DoctorFlagsToggleProps) {
  const { t } = useTranslation(['doctor', 'common']);
  const utils = trpc.useUtils();
  // tRPC inferred type derinliği nedeniyle loose cast (denetim P1 #3.25 pattern).
  const looseDoctor = trpc.doctor as unknown as {
    findById: {
      useQuery: (input: { id: string }) => {
        data?: { user?: { flags?: Record<string, boolean> | null } | null };
      };
    };
  };
  const doctor = looseDoctor.findById.useQuery({ id: doctorId });

  const initialFlags = doctor.data?.user?.flags ?? {};
  const [canSeeAll, setCanSeeAll] = useState<boolean>(Boolean(initialFlags.can_see_all_patients));
  const [isVisiting, setIsVisiting] = useState<boolean>(Boolean(initialFlags.is_visiting_doctor));
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    const f = doctor.data?.user?.flags ?? {};
    setCanSeeAll(Boolean(f.can_see_all_patients));
    setIsVisiting(Boolean(f.is_visiting_doctor));
  }, [doctor.data]);

  // tRPC inferred type bu mutation için "Type instantiation excessively deep"
  // hatası veriyor (registry + permission middleware zinciri derin). Loose cast
  // ile bypass — runtime tip güvenli, sadece compile-time tip recursion sorunu.
  // Mevcut pattern: CommissionPage/FraudPage'de aynı (denetim P1 #3.25).
  const looseUpdate = trpc.doctor as unknown as {
    updateFlags: {
      useMutation: (opts: { onSuccess: () => Promise<void> | void }) => {
        mutate: (input: {
          id: string;
          flags: { is_visiting_doctor?: boolean; can_see_all_patients?: boolean };
        }) => void;
        isPending: boolean;
        error: { message: string } | null;
      };
    };
  };
  const update = looseUpdate.updateFlags.useMutation({
    onSuccess: async () => {
      setSavedNotice(true);
      await utils.doctor.findById.invalidate({ id: doctorId });
      setTimeout(() => setSavedNotice(false), 3000);
    },
  });

  return (
    <section className="rounded-md border p-4 space-y-3" data-testid="doctor-flags-toggle">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">
          {t('doctor:flags.title', { defaultValue: 'Yetki Bayrakları (Yönetici)' })}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t('doctor:flags.description', {
            defaultValue:
              "Bu doktorun hasta görüntüleme kapsamını özelleştirir. Değişiklik doktorun bir sonraki login'inde aktif olur.",
          })}
        </p>
      </div>
      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={canSeeAll}
            onChange={(e) => setCanSeeAll(e.target.checked)}
            className="mt-0.5"
            disabled={isVisiting}
            data-testid="flag-can-see-all"
          />
          <span>
            <span className="font-medium">
              {t('doctor:flags.canSeeAll.label', {
                defaultValue: 'Tüm hastaları görsün (baş hekim)',
              })}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t('doctor:flags.canSeeAll.hint', {
                defaultValue:
                  'Default sıkı izolasyon kalkar; doktor klinikte atanmamış hastaları da görebilir.',
              })}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isVisiting}
            onChange={(e) => setIsVisiting(e.target.checked)}
            className="mt-0.5"
            data-testid="flag-is-visiting"
          />
          <span>
            <span className="font-medium">
              {t('doctor:flags.visiting.label', { defaultValue: 'Misafir cerrah' })}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t('doctor:flags.visiting.hint', {
                defaultValue:
                  'Sadece kendi yaptığı cerrahilerin hastalarını görür; randevu/muayene auto-atamalarını yok sayar. Daha kısıtlayıcı, "tüm hastalar" yetkisini ezer.',
              })}
            </span>
          </span>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() =>
            update.mutate({
              id: doctorId,
              flags: { can_see_all_patients: canSeeAll, is_visiting_doctor: isVisiting },
            })
          }
          disabled={update.isPending}
        >
          {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('common:actions.save', { defaultValue: 'Kaydet' })}
        </Button>
        {savedNotice && (
          <span className="text-xs text-emerald-600">
            {t('doctor:flags.saved', {
              defaultValue: "✓ Kaydedildi (doktor yeni login'inde geçerli)",
            })}
          </span>
        )}
        {update.error && <span className="text-xs text-destructive">{update.error.message}</span>}
      </div>
    </section>
  );
}
