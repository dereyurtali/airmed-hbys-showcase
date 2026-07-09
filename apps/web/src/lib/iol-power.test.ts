import { describe, expect, it } from 'vitest';
import { calculateIolPowerSRK2, validateBiometryField } from './iol-power';

describe('SRK II IOL power', () => {
  it('normal eye (AL 23.5, K 43.5, A 118.4) → ~20.5 D emmetropia', () => {
    // P = 118.4 − 0.9·43.5 − 2.5·23.5 = 20.5
    expect(calculateIolPowerSRK2({ axialLength: 23.5, meanK: 43.5, aConstant: 118.4 })).toBe(20.5);
  });

  it('short eye (AL 21.5) gets +1 A-constant adjustment → higher power', () => {
    // aAdj = 119.4; P = 119.4 − 39.15 − 53.75 = 26.5
    expect(calculateIolPowerSRK2({ axialLength: 21.5, meanK: 43.5, aConstant: 118.4 })).toBe(26.5);
  });

  it('long eye (AL 25) gets −0.5 A-constant adjustment → lower power', () => {
    // aAdj = 117.9; P = 117.9 − 39.15 − 62.5 = 16.25
    expect(calculateIolPowerSRK2({ axialLength: 25, meanK: 43.5, aConstant: 118.4 })).toBe(16.25);
  });

  it('target refraction shifts power (myopic target lowers/raises per CR)', () => {
    const emm = calculateIolPowerSRK2({ axialLength: 23.5, meanK: 43.5, aConstant: 118.4 })!;
    const target = calculateIolPowerSRK2({
      axialLength: 23.5,
      meanK: 43.5,
      aConstant: 118.4,
      targetRefraction: -1,
    })!;
    // emm power 20.5 > 14 → CR 1.0; P_target = 20.5 − (−1)·1.0 = 21.5
    expect(target).toBe(21.5);
    expect(target).not.toBe(emm);
  });

  it('out-of-range axial length (transcription error) → null', () => {
    expect(calculateIolPowerSRK2({ axialLength: 2.3, meanK: 43.5, aConstant: 118.4 })).toBeNull();
    expect(calculateIolPowerSRK2({ axialLength: 31, meanK: 43.5, aConstant: 118.4 })).toBeNull();
  });

  it('out-of-range K → null', () => {
    expect(calculateIolPowerSRK2({ axialLength: 23.5, meanK: 60, aConstant: 118.4 })).toBeNull();
  });
});

describe('biometry range validation', () => {
  it('accepts physiologic values', () => {
    expect(validateBiometryField('axialLength', 23.5)).toBeNull();
    expect(validateBiometryField('k1', 43)).toBeNull();
    expect(validateBiometryField('acd', 3.2)).toBeNull();
  });

  it('flags out-of-range values with the range', () => {
    expect(validateBiometryField('axialLength', 2.3)).toEqual({ min: 20, max: 30, unit: 'mm' });
    expect(validateBiometryField('k1', 60)).toEqual({ min: 35, max: 50, unit: 'D' });
  });
});
