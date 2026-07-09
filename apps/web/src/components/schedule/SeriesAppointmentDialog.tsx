import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Trash2, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DateTimeField } from '../ui/date-field';
import { Label } from '../ui/label';
import { trpc } from '../../lib/trpc';
import { CREATABLE_APPOINTMENT_TYPES, type AppointmentType } from '../../lib/appointment.constants';
import { PatientCommandPicker, type SelectedPatient } from './PatientCommandPicker';

// #383 — Seri randevu yardımcısı: tek-saat disiplinini bozmadan N hastayı
// ardışık AYRI slotlara dağıtır (blok modeli DEĞİL). Her hasta için ayrı
// appointment.create → #368 müsaitlik/çakışma kontrolü her birine uygulanır.

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  doctors: { id: string; name: string }[];
  defaultDoctorId?: string;
  defaultDate: Date;
  onDone: () => void;
}

function toLocalDateTimeInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

export function SeriesAppointmentDialog({
  open,
  onOpenChange,
  doctors,
  defaultDoctorId,
  defaultDate,
  onDone,
}: Props) {
  const { t } = useTranslation(['appointment', 'common']);
  const [doctorId, setDoctorId] = useState(defaultDoctorId ?? doctors[0]?.id ?? '');
  const [type, setType] = useState<AppointmentType>('consultation');
  const [start, setStart] = useState(() => {
    const d = new Date(defaultDate);
    d.setHours(9, 0, 0, 0);
    return toLocalDateTimeInput(d);
  });
  const [intervalMin, setIntervalMin] = useState('30');
  const [patients, setPatients] = useState<SelectedPatient[]>([]);
  const [picker, setPicker] = useState<SelectedPatient | null>(null);
  const [running, setRunning] = useState(false);

  const create = trpc.appointment.create.useMutation();

  const addPatient = (p: SelectedPatient | null) => {
    if (!p) return;
    setPatients((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
    setPicker(null);
  };

  const submit = async () => {
    const step = parseInt(intervalMin, 10) || 30;
    const base = new Date(start);
    if (!doctorId || patients.length === 0 || Number.isNaN(base.getTime())) return;
    setRunning(true);
    let ok = 0;
    const failures: string[] = [];
    for (let i = 0; i < patients.length; i++) {
      const startsAt = new Date(base.getTime() + i * step * 60_000);
      const endsAt = new Date(startsAt.getTime() + step * 60_000);
      try {
        await create.mutateAsync({
          patientId: patients[i].id,
          doctorId,
          type,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        });
        ok += 1;
      } catch (e) {
        failures.push(
          `${patients[i].firstName} ${patients[i].lastName}: ${
            e instanceof Error ? e.message : 'hata'
          }`,
        );
      }
    }
    setRunning(false);
    if (ok > 0)
      toast.success(
        t('series.createdToast', { count: ok, defaultValue: `${ok} randevu oluşturuldu` }),
      );
    if (failures.length > 0) {
      toast.error(
        t('series.someFailed', {
          count: failures.length,
          defaultValue: `${failures.length} randevu oluşturulamadı (çakışma/müsaitlik)`,
        }),
      );
    }
    onDone();
    if (failures.length === 0) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          {t('series.title', { defaultValue: 'Seri Randevu' })}
        </DialogTitle>
        <DialogDescription>
          {t('series.description', {
            defaultValue:
              'Birden çok hastayı ardışık ayrı saatlere dağıtır. Her hasta kendi slotuna gider (tek-saat disiplini korunur).',
          })}
        </DialogDescription>

        <div className="mt-2 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('dialog.fields.doctor', { defaultValue: 'Doktor' })}</Label>
              <select
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t('dialog.fields.type', { defaultValue: 'Tip' })}</Label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AppointmentType)}
                className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {CREATABLE_APPOINTMENT_TYPES.map((tp) => (
                  <option key={tp} value={tp}>
                    {t(`type.${tp}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('series.startLabel', { defaultValue: 'Başlangıç' })}</Label>
              <DateTimeField value={start} onChange={setStart} />
            </div>
            <div className="space-y-1">
              <Label>{t('series.intervalLabel', { defaultValue: 'Aralık (dk)' })}</Label>
              <Input
                type="number"
                min={5}
                step={5}
                value={intervalMin}
                onChange={(e) => setIntervalMin(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t('series.addPatient', { defaultValue: 'Hasta ekle' })}</Label>
            <PatientCommandPicker selected={picker} onSelect={addPatient} />
          </div>

          {patients.length > 0 && (
            <ol className="space-y-1 rounded-md border p-2 text-sm">
              {patients.map((p, i) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span className="tabular-nums text-xs text-muted-foreground">{i + 1}.</span>
                  <span className="flex-1 truncate">
                    {p.firstName} {p.lastName}{' '}
                    <span className="text-xs text-muted-foreground">{p.mrn}</span>
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setPatients((prev) => prev.filter((x) => x.id !== p.id))}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ol>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={submit}
              disabled={running || !doctorId || patients.length === 0}
              data-testid="series-submit"
            >
              <Plus className="mr-1 h-4 w-4" />
              {t('series.submit', {
                count: patients.length,
                defaultValue: `${patients.length} randevu ver`,
              })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
