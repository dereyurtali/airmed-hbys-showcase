import { useTranslation } from 'react-i18next';
import { AlertTriangle, Droplet } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

/**
 * Sticky klinik uyarı barı — airmed-design Ray 1 (hasta kimliği daima görünür) +
 * Ray 2 (alerji sticky kırmızı banner, dismiss YOK). Hasta-bağlamlı her sayfa/dialog üstünde.
 * Eksik onam / aktif recall gibi ek uyarılar `alerts` ile geçilir (amber/kritik + opsiyonel CTA).
 */

export interface ClinicalBannerPatient {
  firstName: string;
  lastName: string;
  mrn: string;
  birthDate?: string | Date | null;
  gender?: 'male' | 'female' | 'other' | string | null;
  allergies?: string[] | null;
  anticoagulantMedications?: string[] | null;
}

export interface ClinicalBannerAlert {
  id: string;
  tone?: 'warning' | 'critical';
  text: string;
  cta?: { label: string; onClick: () => void };
}

interface StickyClinicalAlertBannerProps {
  patient: ClinicalBannerPatient;
  alerts?: ClinicalBannerAlert[];
  className?: string;
}

function ageFromBirthDate(birthDate?: string | Date | null): number | null {
  if (!birthDate) return null;
  const d = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export function StickyClinicalAlertBanner({
  patient,
  alerts = [],
  className,
}: StickyClinicalAlertBannerProps) {
  const { t } = useTranslation(['clinical']);
  const age = ageFromBirthDate(patient.birthDate);
  const allergies = (patient.allergies ?? []).filter(Boolean);
  const anticoagulants = (patient.anticoagulantMedications ?? []).filter(Boolean);
  const genderLabel = patient.gender ? t(`clinical:banner.gender.${patient.gender}`, '') : '';

  const meta = [
    age != null ? `${age} ${t('clinical:banner.years')}` : null,
    genderLabel || null,
  ].filter(Boolean);

  return (
    <div className={cn('sticky top-0 z-40', className)}>
      {/* Ray 1 — hasta kimliği daima görünür */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b bg-background px-4 py-2">
        <span className="font-semibold" data-testid="clinical-banner-name">
          {patient.firstName} {patient.lastName}
        </span>
        <span className="font-mono text-sm text-muted-foreground" data-testid="clinical-banner-mrn">
          {patient.mrn}
        </span>
        {meta.length > 0 && (
          <span className="text-sm text-muted-foreground">· {meta.join(' · ')}</span>
        )}
      </div>

      {/* Ray 2 — alerji sticky kırmızı, dismiss yok */}
      {allergies.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-critical-border bg-critical-bg px-4 py-2 text-sm text-critical-foreground"
          data-testid="clinical-banner-allergy"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">{t('clinical:banner.allergy')}:</span>{' '}
            {allergies.join(', ')}
          </span>
        </div>
      )}

      {anticoagulants.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-warning-border bg-warning-bg px-4 py-2 text-sm text-warning-foreground"
          data-testid="clinical-banner-anticoagulant"
        >
          <Droplet className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">{t('clinical:banner.anticoagulant')}:</span>{' '}
            {anticoagulants.join(', ')}
          </span>
        </div>
      )}

      {alerts.map((a) => (
        <div
          key={a.id}
          role="alert"
          className={cn(
            'flex items-center justify-between gap-2 border-b px-4 py-2 text-sm',
            a.tone === 'critical'
              ? 'border-critical-border bg-critical-bg text-critical-foreground'
              : 'border-warning-border bg-warning-bg text-warning-foreground',
          )}
          data-testid={`clinical-banner-alert-${a.id}`}
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {a.text}
          </span>
          {a.cta && (
            <Button variant="outline" size="sm" onClick={a.cta.onClick}>
              {a.cta.label}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
