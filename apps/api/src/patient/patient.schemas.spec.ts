import { patientCreateSchema } from './patient.schemas';

// Hasta birincil telefonu zorunlu — hem boş hem null hem eksik reddedilir.
// Klinik takip ve mesajlaşma için kritik; pilot kararı (madde 3).

describe('patientCreateSchema — phone required', () => {
  const base = {
    firstName: 'Ali',
    lastName: 'Veli',
    birthDate: '1980-01-01',
    gender: 'male' as const,
    phone: '+992111111111',
  };

  it('valid input geçer', () => {
    expect(patientCreateSchema.safeParse(base).success).toBe(true);
  });

  it('phone yok → reddedilir', () => {
    expect(
      patientCreateSchema.safeParse({
        firstName: 'Ali',
        lastName: 'Veli',
        birthDate: '1980-01-01',
        gender: 'male' as const,
      }).success,
    ).toBe(false);
  });

  it('phone null → reddedilir', () => {
    expect(patientCreateSchema.safeParse({ ...base, phone: null }).success).toBe(false);
  });

  it('phone boş string → reddedilir (min 4)', () => {
    expect(patientCreateSchema.safeParse({ ...base, phone: '' }).success).toBe(false);
  });

  it('phone kısa (<4) → reddedilir', () => {
    expect(patientCreateSchema.safeParse({ ...base, phone: '+9' }).success).toBe(false);
  });

  it('phone rakamsız format → reddedilir', () => {
    expect(patientCreateSchema.safeParse({ ...base, phone: '++++++' }).success).toBe(false);
  });

  it('phone valid format (boşluklu/parantezli) → kabul', () => {
    expect(patientCreateSchema.safeParse({ ...base, phone: '+992 (90) 123-4567' }).success).toBe(
      true,
    );
  });
});
