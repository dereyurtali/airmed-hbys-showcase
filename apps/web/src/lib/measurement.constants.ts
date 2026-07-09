// A9 ölçüm — frontend constants + tip-bazlı alan şeması.
//
// Backend Prisma enum MeasurementType 10 değer içerir; frontend bu PR'da 4
// yapılandırılmış tip için form sunar (VA, IOP, refraction, keratometry).
// Geri kalan 6 tip (biometry, topography, pachymetry, perimetry, fundus_photo,
// oct) backend'de saklanır ama bu sürüm form'da gösterilmez — görüntü/cihaz
// import akışı C3 + ileri B serisi PR'larında eklenir.
//
// values JSONB shape:
//   visual_acuity:        { od?, os?, notation? }
//   intraocular_pressure: { od?, os? }                       (mmHg)
//   refraction:           { odSph?, odCyl?, odAxis?, osSph?, osCyl?, osAxis? }
//   keratometry:          { odK1?, odK2?, odAxis?, osK1?, osK2?, osAxis? }

export const MEASUREMENT_TYPES = [
  'visual_acuity',
  'intraocular_pressure',
  'refraction',
  'biometry',
  'keratometry',
  'topography',
  'pachymetry',
  'perimetry',
  'fundus_photo',
  'oct',
] as const;
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];

export const SUPPORTED_FORM_TYPES = [
  'visual_acuity',
  'intraocular_pressure',
  'refraction',
  'keratometry',
] as const satisfies readonly MeasurementType[];
export type SupportedFormType = (typeof SUPPORTED_FORM_TYPES)[number];

export function isSupportedFormType(t: MeasurementType): t is SupportedFormType {
  return (SUPPORTED_FORM_TYPES as readonly string[]).includes(t);
}

export type FieldInput = 'number' | 'text';

export interface FieldDef {
  key: string;
  input: FieldInput;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
}

// Her tip için OD/OS alan grubu. Form bu şemayı render eder; i18n keyleri
// `measurement:fields.<typeKey>.<fieldKey>` formatında.
export const TYPE_FIELDS: Record<SupportedFormType, FieldDef[]> = {
  visual_acuity: [
    { key: 'od', input: 'text' },
    { key: 'os', input: 'text' },
  ],
  intraocular_pressure: [
    { key: 'od', input: 'number', unit: 'mmHg', step: 0.5, min: 0, max: 80 },
    { key: 'os', input: 'number', unit: 'mmHg', step: 0.5, min: 0, max: 80 },
  ],
  refraction: [
    { key: 'odSph', input: 'number', step: 0.25, min: -30, max: 30 },
    { key: 'odCyl', input: 'number', step: 0.25, min: -15, max: 15 },
    { key: 'odAxis', input: 'number', step: 1, min: 0, max: 180 },
    { key: 'osSph', input: 'number', step: 0.25, min: -30, max: 30 },
    { key: 'osCyl', input: 'number', step: 0.25, min: -15, max: 15 },
    { key: 'osAxis', input: 'number', step: 1, min: 0, max: 180 },
  ],
  keratometry: [
    { key: 'odK1', input: 'number', unit: 'D', step: 0.01, min: 30, max: 60 },
    { key: 'odK2', input: 'number', unit: 'D', step: 0.01, min: 30, max: 60 },
    { key: 'odAxis', input: 'number', step: 1, min: 0, max: 180 },
    { key: 'osK1', input: 'number', unit: 'D', step: 0.01, min: 30, max: 60 },
    { key: 'osK2', input: 'number', unit: 'D', step: 0.01, min: 30, max: 60 },
    { key: 'osAxis', input: 'number', step: 1, min: 0, max: 180 },
  ],
};

export type MeasurementValues = Record<string, string | number | null>;

export const SAME_DAY_WINDOW_HOURS = 24;

export function isWithinSameDayWindow(measuredAt: Date | string): boolean {
  const d = typeof measuredAt === 'string' ? new Date(measuredAt) : measuredAt;
  const ageMs = Date.now() - d.getTime();
  return ageMs < SAME_DAY_WINDOW_HOURS * 60 * 60 * 1000;
}

// Liste hücresi için tip-bazlı kısa özet (tablo "Değer" kolonu). Detay
// dialog'da tüm alanlar gösterilir.
export function summarizeValues(type: MeasurementType, values: MeasurementValues): string {
  if (!values || Object.keys(values).length === 0) return '—';
  switch (type) {
    case 'visual_acuity':
      return `OD ${values.od ?? '?'} / OS ${values.os ?? '?'}`;
    case 'intraocular_pressure':
      return `OD ${values.od ?? '?'} / OS ${values.os ?? '?'} mmHg`;
    case 'refraction': {
      const od = `${values.odSph ?? '?'} ${values.odCyl ?? ''}×${values.odAxis ?? ''}`;
      const os = `${values.osSph ?? '?'} ${values.osCyl ?? ''}×${values.osAxis ?? ''}`;
      return `OD ${od} | OS ${os}`;
    }
    case 'keratometry': {
      const od = `${values.odK1 ?? '?'}/${values.odK2 ?? '?'}@${values.odAxis ?? '?'}`;
      const os = `${values.osK1 ?? '?'}/${values.osK2 ?? '?'}@${values.osAxis ?? '?'}`;
      return `OD ${od} | OS ${os}`;
    }
    default:
      return JSON.stringify(values);
  }
}
