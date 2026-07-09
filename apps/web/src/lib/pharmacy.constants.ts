// E3 Eczane / Optikçi — frontend constants.

export const SUPPLIER_CATEGORIES = ['pharmacy', 'optic', 'other'] as const;
export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number];

export const PRESCRIPTION_TYPES = ['drug', 'eyewear'] as const;
export type PrescriptionType = (typeof PRESCRIPTION_TYPES)[number];

// Drug Rx satırı: ilaç + doz + sıklık + süre
export interface DrugItem {
  name: string;
  dose?: string;
  frequency?: string;
  duration?: string;
}

// Eyewear Rx satırı: göz başına diyopter/silindir/axis/add + PD ortak
export interface EyewearItem {
  eye: 'OD' | 'OS';
  sphere?: number | string;
  cylinder?: number | string;
  axis?: number | string;
  add?: number | string;
  pd?: number | string;
}

export function buildQrPayload(rx: {
  id: string;
  type: PrescriptionType;
  patient: { mrn: string; firstName: string; lastName: string };
  supplier: { name: string; category: string } | null;
  items: unknown[];
  notes: string | null;
  createdAt: string | Date;
}): string {
  return JSON.stringify({
    v: 1,
    id: rx.id,
    type: rx.type,
    patient: {
      mrn: rx.patient.mrn,
      name: `${rx.patient.lastName} ${rx.patient.firstName}`,
    },
    supplier: rx.supplier?.name ?? null,
    items: rx.items,
    notes: rx.notes,
    createdAt: typeof rx.createdAt === 'string' ? rx.createdAt : rx.createdAt.toISOString(),
  });
}
