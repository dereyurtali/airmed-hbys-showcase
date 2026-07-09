import { parseNbtUsdRate, nbtRatesUrl } from './nbt.provider';

describe('parseNbtUsdRate', () => {
  it('CBR-element stili (CharCode + virgüllü Value)', () => {
    const xml = `<?xml version="1.0"?><ValCurs date="17.06.2026">
      <Valute><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>10,1234</Value></Valute>
      <Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>9,2978</Value></Valute>
    </ValCurs>`;
    expect(parseNbtUsdRate(xml)).toBeCloseTo(9.2978, 4);
  });

  it('attribute stili (code + nokta ondalık <value>)', () => {
    const xml = `<CurrencyRates date="2026-06-17">
      <Currency code="RUB" nominal="1"><value>0.12</value></Currency>
      <Currency code="USD" nominal="1"><value>9.2978</value></Currency>
    </CurrencyRates>`;
    expect(parseNbtUsdRate(xml)).toBeCloseTo(9.2978, 4);
  });

  it('Nominal > 1 ise tek birime böler', () => {
    const xml = `<ValCurs><Valute><CharCode>USD</CharCode><Nominal>10</Nominal><Value>92.978</Value></Valute></ValCurs>`;
    expect(parseNbtUsdRate(xml)).toBeCloseTo(9.2978, 4);
  });

  it('USD yoksa null', () => {
    const xml = `<ValCurs><Valute><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>10,12</Value></Valute></ValCurs>`;
    expect(parseNbtUsdRate(xml)).toBeNull();
  });

  it('boş/bozuk girdi → null (offline-safe)', () => {
    expect(parseNbtUsdRate('')).toBeNull();
    expect(parseNbtUsdRate('not xml at all')).toBeNull();
    expect(parseNbtUsdRate(undefined as unknown as string)).toBeNull();
  });
});

describe('nbtRatesUrl', () => {
  it('date parametresini ekler', () => {
    expect(nbtRatesUrl('2026-06-17')).toContain('date=2026-06-17');
  });
});
