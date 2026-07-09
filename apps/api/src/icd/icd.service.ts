import { Injectable } from '@nestjs/common';
import { ICD10_CODES, type IcdCode } from './icd.codes';

// E4 ICD-10 — basit search service. Tenant-bağımsız sabit listede arama.
//
// Aranan terim: code prefix + 3 dilde label substring (i18n için kullanıcı
// kendi dilinde arar). Sonuç max 25 öğe ile sınırlı (autocomplete).

type Locale = 'tr' | 'ru' | 'tg';

@Injectable()
export class IcdService {
  search(query: string, locale: Locale = 'tr', limit = 25): IcdCode[] {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];

    const matches: IcdCode[] = [];
    for (const c of ICD10_CODES) {
      if (matches.length >= limit) break;
      if (
        c.code.toLowerCase().startsWith(q) ||
        c.tr.toLowerCase().includes(q) ||
        c.ru.toLowerCase().includes(q) ||
        c.tg.toLowerCase().includes(q) ||
        // Aynı locale içinde de aramak için her zaman 3 dil
        c[locale].toLowerCase().includes(q)
      ) {
        matches.push(c);
      }
    }
    return matches;
  }

  getByCodes(codes: string[]): IcdCode[] {
    const wanted = new Set(codes);
    return ICD10_CODES.filter((c) => wanted.has(c.code));
  }
}
