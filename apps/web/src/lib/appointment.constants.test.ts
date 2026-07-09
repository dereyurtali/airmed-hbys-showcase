import { describe, expect, it } from 'vitest';
import { APPOINTMENT_TYPES, serviceCategoryForAppointmentType } from './appointment.constants';

describe('serviceCategoryForAppointmentType (Karar 4)', () => {
  it('muayene/kontrol → examination (resepsiyon giriş ücreti)', () => {
    expect(serviceCategoryForAppointmentType('consultation')).toBe('examination');
    expect(serviceCategoryForAppointmentType('control')).toBe('examination');
    expect(serviceCategoryForAppointmentType('examination')).toBe('examination');
  });

  it('enjeksiyon/lazer → procedure', () => {
    expect(serviceCategoryForAppointmentType('injection')).toBe('procedure');
    expect(serviceCategoryForAppointmentType('laser')).toBe('procedure');
  });

  it('cerrahi/pre_op/post_op → null (otomatik kalem yok; ayrı akış)', () => {
    expect(serviceCategoryForAppointmentType('surgery')).toBeNull();
    expect(serviceCategoryForAppointmentType('pre_op')).toBeNull();
    expect(serviceCategoryForAppointmentType('post_op')).toBeNull();
  });

  it('tüm randevu tipleri map içinde tanımlı (eksik tip yok)', () => {
    for (const t of APPOINTMENT_TYPES) {
      // null veya geçerli kategori; undefined OLMAMALI
      expect(serviceCategoryForAppointmentType(t)).not.toBeUndefined();
    }
  });
});
