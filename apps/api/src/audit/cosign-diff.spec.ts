import { computeFieldDiff, COSIGN_DIFF_SOURCES } from './cosign-diff';

describe('cosign-diff — R1 alan-bazlı diff', () => {
  it('değişen scalar alanları yakalar, teknik alanları atlar', () => {
    const before = {
      id: 'x',
      tenantId: 't',
      patientId: 'p',
      diagnosis: 'Glokom',
      treatmentPlan: 'A',
      updatedAt: new Date('2026-01-01'),
    };
    const after = {
      id: 'x',
      tenantId: 't',
      patientId: 'p',
      diagnosis: 'Katarakt',
      treatmentPlan: 'A',
      updatedAt: new Date('2026-02-02'),
    };
    const diff = computeFieldDiff(before, after);
    // diagnosis değişti; id/tenantId/patientId/updatedAt skip; treatmentPlan aynı.
    expect(diff).toEqual([{ field: 'diagnosis', before: 'Glokom', after: 'Katarakt' }]);
  });

  it('JSON alanlarını derin karşılaştırır (eşitse diff yok)', () => {
    const before = { findings: { odVa: '1.0', osVa: '0.8' } };
    const after = { findings: { odVa: '1.0', osVa: '0.8' } };
    expect(computeFieldDiff(before, after)).toEqual([]);
  });

  it('JSON alan değişince yakalar', () => {
    const before = { findings: { odVa: '1.0' } };
    const after = { findings: { odVa: '0.6' } };
    const diff = computeFieldDiff(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0].field).toBe('findings');
  });

  it('before/after null ise boş diff', () => {
    expect(computeFieldDiff(null, { a: 1 })).toEqual([]);
    expect(computeFieldDiff({ a: 1 }, null)).toEqual([]);
  });

  it('registry co-signable update path → model eşler', () => {
    expect(COSIGN_DIFF_SOURCES['examination.update']).toBe('examination');
    expect(COSIGN_DIFF_SOURCES['surgery.update']).toBe('surgery');
    expect(COSIGN_DIFF_SOURCES['measurement.update']).toBe('measurement');
    expect(COSIGN_DIFF_SOURCES['procedure.update']).toBe('procedure');
  });
});
