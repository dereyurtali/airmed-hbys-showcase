import { describe, expect, it } from 'vitest';
import {
  emptyPatientForm,
  patientFormSchema,
  toApiPayload,
  type PatientFormValues,
} from './patient.schemas';

const validForm: PatientFormValues = {
  ...emptyPatientForm,
  firstName: 'Ali',
  lastName: 'Veli',
  birthDate: '1980-01-01',
  gender: 'male',
  phone: '+992 90 123 4567',
};

describe('patientFormSchema', () => {
  it('valid minimum payload geçer', () => {
    expect(patientFormSchema.safeParse(validForm).success).toBe(true);
  });

  it.each(['firstName', 'lastName'] as const)('boş %s reddedilir', (field) => {
    const result = patientFormSchema.safeParse({ ...validForm, [field]: '' });
    expect(result.success).toBe(false);
  });

  it('birthDate yanlış format reddedilir (YYYY-AA-GG zorunlu)', () => {
    expect(patientFormSchema.safeParse({ ...validForm, birthDate: '01/01/1980' }).success).toBe(
      false,
    );
    expect(patientFormSchema.safeParse({ ...validForm, birthDate: '1980-1-1' }).success).toBe(
      false,
    );
  });

  it('phone zorunlu — boş reddedilir', () => {
    expect(patientFormSchema.safeParse({ ...validForm, phone: '' }).success).toBe(false);
  });

  it('phone regex sadece izinli karakterlere izin verir', () => {
    expect(patientFormSchema.safeParse({ ...validForm, phone: '+992 90 123-4567' }).success).toBe(
      true,
    );
    expect(patientFormSchema.safeParse({ ...validForm, phone: '992-abc' }).success).toBe(false);
  });

  it('email opsiyonel ama dolduysa geçerli email olmalı', () => {
    expect(patientFormSchema.safeParse({ ...validForm, email: '' }).success).toBe(true);
    expect(patientFormSchema.safeParse({ ...validForm, email: 'a@b.co' }).success).toBe(true);
    expect(patientFormSchema.safeParse({ ...validForm, email: 'not-an-email' }).success).toBe(
      false,
    );
  });

  it('leadSource enum dışı değer reddedilir', () => {
    const result = patientFormSchema.safeParse({
      ...validForm,
      leadSource: 'facebook' as never,
    });
    expect(result.success).toBe(false);
  });

  it('tags max 15 elemana sınırlı', () => {
    const tooMany = Array(16).fill('vip') as never[];
    const result = patientFormSchema.safeParse({ ...validForm, tags: tooMany });
    expect(result.success).toBe(false);
  });

  it('gender enum dışı değer reddedilir', () => {
    const result = patientFormSchema.safeParse({ ...validForm, gender: 'unknown' as never });
    expect(result.success).toBe(false);
  });
});

describe('toApiPayload', () => {
  it('zorunlu alanlar olduğu gibi geçer', () => {
    const payload = toApiPayload(validForm);
    expect(payload.firstName).toBe('Ali');
    expect(payload.lastName).toBe('Veli');
    expect(payload.birthDate).toBe('1980-01-01');
    expect(payload.gender).toBe('male');
  });

  it("phone zorunlu olduğu için validForm.phone payload'a olduğu gibi geçer", () => {
    const payload = toApiPayload(validForm);
    expect(payload.phone).toBe('+992 90 123 4567');
  });

  it('boş string opsiyonel alanlar null olur (phone hariç — zorunlu)', () => {
    const payload = toApiPayload(validForm);
    expect(payload.email).toBeNull();
    expect(payload.address).toBeNull();
    expect(payload.notes).toBeNull();
    expect(payload.leadSource).toBeNull();
  });

  it('dolu opsiyonel alanlar değerlerini korur', () => {
    const payload = toApiPayload({
      ...validForm,
      email: 'a@b.co',
      leadSource: 'instagram',
    });
    expect(payload.email).toBe('a@b.co');
    expect(payload.leadSource).toBe('instagram');
  });

  it('tags undefined ise boş array döner', () => {
    const payload = toApiPayload({ ...validForm, tags: undefined as never });
    expect(payload.tags).toEqual([]);
  });

  it('tags dolu ise olduğu gibi geçer', () => {
    const payload = toApiPayload({ ...validForm, tags: ['vip', 'risk_high'] });
    expect(payload.tags).toEqual(['vip', 'risk_high']);
  });
});
