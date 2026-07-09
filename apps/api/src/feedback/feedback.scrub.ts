// I2.3 (#821) — issue-body PII scrub. Kanonik scrubber I1.1 (#813) merge oldu;
// bu modül artık ortak `@airmed/observability` redactor'ına delege eder. Token'lar
// (`[e-posta]`, `[numara]`) feedback testleriyle aynı kalır; ek olarak MRN/TCKN/
// telefon desenleri de maskelenir.
import { scrubText } from '@airmed/observability';

export function scrubPii(text: string): string {
  return scrubText(text);
}
