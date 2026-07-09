import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Stethoscope, UserCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';
import { useAuth } from '../../providers/AuthProvider';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface DoctorOption {
  id: string;
  name: string;
  userId: string | null;
}

/**
 * S15-PR11 — Hemşire "Acting on Behalf" widget'ı. TopBar'da yer alır. Aktif
 * session varsa "Dr. X adına çalışıyorsun" banner + Sonlandır butonu; yoksa
 * doktor seç dropdown + Başlat.
 *
 * v0.4 İP-8 (#544) — Acting-doctor yalnız Asistan modunun kavramıdır → widget
 * yalnız Asistan modunda (ve mod'suz klasik hemşirede, geri-uyum) görünür. Genel
 * mod (klinik-geneli görev) ve Ölçüm kiosk'u acting-doctor kullanmaz → gizli.
 */
export function NurseSessionWidget() {
  const { t } = useTranslation(['nurse', 'common']);
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const utils = trpc.useUtils();

  // Asistan modu (veya mod'suz klasik hemşire) görür; genel/olcum gizler.
  const isNurse = (user?.roles ?? []).includes('hemsire');
  const usesActingDoctor = isNurse && user?.mode !== 'genel' && user?.mode !== 'olcum';

  const session = trpc.nurseSession.my.useQuery(undefined, { enabled: usesActingDoctor });
  const doctorsList = trpc.doctor.list.useQuery(
    { page: 1, pageSize: 200, isActive: true },
    { enabled: usesActingDoctor, staleTime: 5 * 60 * 1000 },
  );
  // R2 (#724) — Asistan modunda acting-doctor'ın aktif muayene yükü (N/3 cap).
  // Endpoint acting-doctor aware (encounter.router): hemşire Dr. X'in yükünü görür.
  const examLoad = trpc.encounter.myActiveExamCount.useQuery(undefined, {
    enabled: usesActingDoctor,
    refetchInterval: 60_000,
  });

  // Session değişince doktor-scope'lu ekranlar (worklist + hasta listesi) yeniden
  // çekilmeli: hemşire artık Dr. X'in kuyruğunu/hastalarını görür ya da görmeyi
  // bırakır. nurseSession.my zaten sidebar başlığını + rozeti tazeler.
  const invalidateActingScopes = () => {
    void utils.nurseSession.my.invalidate();
    void utils.encounter.myWorklist.invalidate();
    void utils.patient.list.invalidate();
  };

  const start = trpc.nurseSession.start.useMutation({
    onSuccess: () => {
      invalidateActingScopes();
      toast.success(t('nurse:session.started'));
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });
  const end = trpc.nurseSession.end.useMutation({
    onSuccess: () => {
      invalidateActingScopes();
      toast.success(t('nurse:session.ended'));
    },
    onError: (e) => toast.error(mapTrpcError(e, t)),
  });

  const [isOpen, setIsOpen] = useState(false);

  if (!usesActingDoctor) return null;
  if (session.isLoading) return null;

  const active = session.data;

  if (active) {
    // Active session: doktor adı için listeden bul. unknownDoctor "sessiz
    // fallback" değil — liste yüklenirken belirsiz, yüklenip de bulunamazsa
    // (pasif/silinmiş doktor) amber uyarı ile gösterilir (yanlış audit riski).
    const doctors = (doctorsList.data?.items ?? []) as DoctorOption[];
    const doctor = doctors.find((d) => d.userId === active.doctorUserId);
    const stillLoading = doctorsList.isLoading;
    const unresolved = !stillLoading && !doctor;
    const switchTargets = doctors.filter((d) => d.userId && d.userId !== active.doctorUserId);
    const load = examLoad.data;
    return (
      <div
        className={
          'flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs ' +
          (unresolved
            ? 'border-amber-300 bg-amber-50 text-amber-900'
            : 'border-blue-300 bg-blue-50 text-blue-900')
        }
      >
        <UserCheck className="h-4 w-4" />
        <span>
          {t('nurse:session.actingForLabel')}{' '}
          <strong>
            {doctor?.name ??
              (stillLoading ? t('common:states.loading') : t('nurse:session.unknownDoctor'))}
          </strong>
        </span>
        {/* R2 (#724) — "Dr. X: N/3 aktif" yük rozeti (cap'te amber). */}
        {load && (
          <span
            className={
              'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ' +
              (load.isAtCap ? 'bg-amber-200 text-amber-900' : 'bg-white/60 text-blue-800')
            }
            title={t('nurse:session.examLoadHint', { cap: load.cap })}
          >
            {t('nurse:session.examLoad', { count: load.count, cap: load.cap })}
          </span>
        )}
        {/* R2 (#724) — "Değiştir": başka doktora geç (start önceki session'ı kapatır). */}
        {switchTargets.length > 0 && (
          <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className={
                  'h-6 px-2 text-xs ' + (unresolved ? 'hover:bg-amber-100' : 'hover:bg-blue-100')
                }
                disabled={start.isPending}
              >
                {t('nurse:session.change')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>{t('nurse:session.pickDoctor')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {switchTargets.map((d) => (
                <DropdownMenuItem
                  key={d.id}
                  onClick={async () => {
                    if (!d.userId) return;
                    if (
                      !(await confirm({
                        message: t('nurse:session.confirmChange', { name: d.name }),
                        destructive: true,
                      }))
                    )
                      return;
                    start.mutate({ doctorUserId: d.userId });
                    setIsOpen(false);
                  }}
                >
                  {d.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          size="sm"
          variant="ghost"
          className={
            'h-6 px-2 text-xs ' + (unresolved ? 'hover:bg-amber-100' : 'hover:bg-blue-100')
          }
          onClick={() => end.mutate({ id: active.id })}
          disabled={end.isPending}
        >
          <X className="mr-1 h-3 w-3" />
          {t('nurse:session.end')}
        </Button>
      </div>
    );
  }

  // Aktif session yok → doktor seçici (yalnız user'ı olan doktorlar).
  const doctors = ((doctorsList.data?.items ?? []) as DoctorOption[]).filter(
    (d) => d.userId !== null,
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Stethoscope className="h-4 w-4" />
          {t('nurse:session.startButton')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t('nurse:session.pickDoctor')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {doctors.length === 0 ? (
          <DropdownMenuItem disabled>{t('nurse:session.noDoctors')}</DropdownMenuItem>
        ) : (
          doctors.map((d) => (
            <DropdownMenuItem
              key={d.id}
              onClick={async () => {
                if (!d.userId) return;
                // Teyit: tek-tık yanlış doktora tüm vardiya audit'lenmesin.
                if (
                  !(await confirm({
                    message: t('nurse:session.confirmStart', { name: d.name }),
                    destructive: true,
                  }))
                )
                  return;
                start.mutate({ doctorUserId: d.userId });
                setIsOpen(false);
              }}
            >
              {d.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
