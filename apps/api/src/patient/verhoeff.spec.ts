import { parseMrn, verhoeffChecksum, verhoeffValidate } from './verhoeff';

describe('Verhoeff', () => {
  it('matches the canonical example: checksum("236") = 3', () => {
    // Wikipedia reference: 236 + 3 = 2363 validates clean.
    expect(verhoeffChecksum('236')).toBe(3);
    expect(verhoeffValidate('2363')).toBe(true);
  });

  it('matches another canonical: checksum("12345") = 1', () => {
    expect(verhoeffChecksum('12345')).toBe(1);
    expect(verhoeffValidate('123451')).toBe(true);
  });

  it('rejects an MRN with a flipped single digit', () => {
    const good = '00000001' + verhoeffChecksum('00000001');
    expect(verhoeffValidate(good)).toBe(true);
    // flip last sequence digit
    const tampered = '00000002' + good.slice(-1);
    expect(verhoeffValidate(tampered)).toBe(false);
  });

  it('rejects an MRN with adjacent digits transposed', () => {
    const good = '12345678' + verhoeffChecksum('12345678');
    expect(verhoeffValidate(good)).toBe(true);
    const swapped = '13245678' + good.slice(-1);
    expect(verhoeffValidate(swapped)).toBe(false);
  });

  it('throws on non-numeric input', () => {
    expect(() => verhoeffChecksum('12a3')).toThrow();
    expect(verhoeffValidate('12a3')).toBe(false);
  });
});

// S13 — Yeni MRN formatı: <prefix(2)><yy(2)><check(1)><seq(5)> = 10 char.
// parseMrn eski 9-haneli formatı kasıtlı olarak reddeder (null döner) →
// doctor MRN aramalarında format karışmaması garanti.
describe('parseMrn (S13 format)', () => {
  it('geçerli yeni format MRN parse eder ve valid=true verir', () => {
    // yy=26, seq=00042 → check = verhoeffChecksum('2600042')
    const check = verhoeffChecksum('2600042');
    const mrn = `TD26${check}00042`;
    const parsed = parseMrn(mrn);
    expect(parsed).not.toBeNull();
    expect(parsed?.prefix).toBe('TD');
    expect(parsed?.year).toBe(2026);
    expect(parsed?.seq).toBe(42);
    expect(parsed?.check).toBe(check);
    expect(parsed?.valid).toBe(true);
  });

  it('eski 9-haneli MRN (TD123456789) → null (regex eşleşmez)', () => {
    expect(parseMrn('TD123456789')).toBeNull();
  });

  it('küçük harf prefix → null (regex /[A-Z]{2}/)', () => {
    const check = verhoeffChecksum('2600001');
    expect(parseMrn(`td26${check}00001`)).toBeNull();
  });

  it('eksik haneli (kısa) MRN → null', () => {
    expect(parseMrn('TD2610042')).toBeNull(); // 9 char
    expect(parseMrn('TD261004')).toBeNull(); // 8 char
  });

  it('fazladan haneli (uzun) MRN → null', () => {
    expect(parseMrn('TD2610042001')).toBeNull(); // 12 char
  });

  it('boş string → null', () => {
    expect(parseMrn('')).toBeNull();
  });

  it('rakam yerine harf olan MRN → null (regex)', () => {
    expect(parseMrn('TDXX100042')).toBeNull();
  });

  it('yanlış check digit → parse eder ama valid=false (tipo tespiti)', () => {
    const realCheck = verhoeffChecksum('2600042');
    const wrongCheck = (realCheck + 1) % 10;
    const mrn = `TD26${wrongCheck}00042`;
    const parsed = parseMrn(mrn);
    expect(parsed).not.toBeNull();
    expect(parsed?.valid).toBe(false);
  });

  it('parse edilen yıl 2-haneli yy üzerinden 2000 offset ile çözülür', () => {
    const check = verhoeffChecksum('9900001');
    const parsed = parseMrn(`TD99${check}00001`);
    expect(parsed?.year).toBe(2099);
  });

  it('seq leading-zero korunur (parse Number döndürür)', () => {
    const check = verhoeffChecksum('2600001');
    const parsed = parseMrn(`TD26${check}00001`);
    expect(parsed?.seq).toBe(1);
  });
});
