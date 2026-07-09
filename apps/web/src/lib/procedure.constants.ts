// B5 Procedure — frontend sabitleri.

export const PROCEDURE_TYPES = [
  'intravitreal_injection',
  'yag_capsulotomy',
  'argon_laser',
  'retina_laser_prp',
  'slt',
  'cross_linking',
  'minor',
] as const;
export type ProcedureType = (typeof PROCEDURE_TYPES)[number];

export const PROCEDURE_STATUSES = ['planned', 'performed', 'cancelled'] as const;
export type ProcedureStatus = (typeof PROCEDURE_STATUSES)[number];

export const EYE_SIDES = ['od', 'os', 'ou'] as const;
export type EyeSide = (typeof EYE_SIDES)[number];

export const ANESTHESIA_TYPES = ['topical', 'local', 'none'] as const;
export type AnesthesiaType = (typeof ANESTHESIA_TYPES)[number];

// Intravitreal için tipik anti-VEGF ilaç önerileri (free text de yazılabilir).
export const COMMON_IVT_DRUGS = [
  'Lucentis',
  'Eylea',
  'Avastin',
  'Beovu',
  'Vabysmo',
  'Ozurdex',
] as const;

// Lazer tipleri için settings alan listesi — dinamik form render için.
export interface ProcedureSettingField {
  key: string;
  type: 'number' | 'text';
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}

export const PROCEDURE_SETTINGS_FIELDS: Record<ProcedureType, ProcedureSettingField[]> = {
  intravitreal_injection: [],
  yag_capsulotomy: [
    { key: 'energy_mj', type: 'number', unit: 'mJ', min: 0, max: 20, step: 0.1 },
    { key: 'pulse_count', type: 'number', min: 0, max: 200, step: 1 },
  ],
  argon_laser: [
    { key: 'energy_mw', type: 'number', unit: 'mW', min: 0, max: 2000, step: 10 },
    { key: 'spot_count', type: 'number', min: 0, max: 2000, step: 1 },
    { key: 'spot_size_um', type: 'number', unit: 'µm', min: 0, max: 500, step: 50 },
  ],
  retina_laser_prp: [
    { key: 'energy_mw', type: 'number', unit: 'mW', min: 0, max: 2000, step: 10 },
    { key: 'spot_count', type: 'number', min: 0, max: 3000, step: 10 },
    { key: 'duration_ms', type: 'number', unit: 'ms', min: 0, max: 500, step: 10 },
  ],
  slt: [
    { key: 'energy_mj', type: 'number', unit: 'mJ', min: 0, max: 5, step: 0.1 },
    { key: 'spot_count', type: 'number', min: 0, max: 200, step: 1 },
  ],
  cross_linking: [
    { key: 'protocol', type: 'text' },
    { key: 'duration_min', type: 'number', unit: 'dk', min: 0, max: 90, step: 1 },
  ],
  minor: [{ key: 'description', type: 'text' }],
};
