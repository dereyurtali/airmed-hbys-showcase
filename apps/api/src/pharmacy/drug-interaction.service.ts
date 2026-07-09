import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  DRUG_INTERACTIONS,
  type DrugInteractionRule,
  type InteractionSeverity,
} from './drug-interactions.constants';

export const checkInteractionsSchema = z.object({
  /** Reçete edilen veya planlanan ilaçların serbest text adları (UI'dan
   *  gelir; canonicalize edilmemiş). 1-30 eleman. */
  drugs: z.array(z.string().min(1).max(150)).min(1).max(30),
  /** Hasta allerji listesi (Patient.allergies). Substring match. */
  allergies: z.array(z.string().min(1).max(100)).max(30).optional(),
  /** Hasta antikoagülan ilaç listesi. NSAID + antikoagülan gibi etkileşim
   *  taraması için (drugs ile birlikte değerlendirilir). */
  anticoagulants: z.array(z.string().min(1).max(100)).max(30).optional(),
  /** Patient.bloodType (opsiyonel; v0.3'te transfüzyon uyarısı için). */
  bloodType: z.string().max(20).optional(),
});

export type CheckInteractionsInput = z.infer<typeof checkInteractionsSchema>;

export interface InteractionWarning {
  /** "interaction" = iki ilaç çifti; "allergy" = ilaç ↔ hasta allerjisi;
   *  "anticoagulant" = ilaç ↔ hasta antikoagülan ilacı çatışması. */
  kind: 'interaction' | 'allergy' | 'anticoagulant';
  severity: InteractionSeverity;
  matchedRule: DrugInteractionRule | null;
  /** TR fallback metni (geriye uyum + log). Frontend `messageKey` varsa onu t() ile basar. */
  message: string;
  /** SİS-1 — i18n çeviri anahtarı (`messageParams` ile). Frontend aktif dilde basar. */
  messageKey?: string;
  messageParams?: Record<string, string>;
  /** Kullanıcının verdiği orijinal ilaç/allerji string'leri (eşleşen). */
  triggers: string[];
}

/**
 * S15-PR4 — Reçete + hasta tıbbi bilgisi ↔ etkileşim katalogu lookup.
 *
 * Algoritma:
 * 1. Reçete ilaçlarını lowercase normalize et.
 * 2. Her çift için DRUG_INTERACTIONS'da substring match ara (commutative).
 * 3. Allerji listesi vs ilaçlar için substring match → 'allergy' uyarısı.
 * 4. Antikoagülan listesi vs ilaçlar için → cross-check (örn. NSAID + warfarin).
 *
 * Pilot for: PrescriptionsSection ve PostExamDecisionPanel reçete yazımında
 * tetiklenir. Block etmez, uyarı modal'ı gösterir; doktor "yine de devam" der.
 */
@Injectable()
export class DrugInteractionService {
  check(input: CheckInteractionsInput): InteractionWarning[] {
    const warnings: InteractionWarning[] = [];
    const normalizedDrugs = input.drugs.map((d) => ({ raw: d, lc: d.toLowerCase().trim() }));
    const allergies = (input.allergies ?? []).map((a) => a.toLowerCase().trim());
    const anticoagulants = (input.anticoagulants ?? []).map((a) => a.toLowerCase().trim());

    // 1. Pair-wise interaction tarama.
    for (let i = 0; i < normalizedDrugs.length; i += 1) {
      for (let j = i; j < normalizedDrugs.length; j += 1) {
        const a = normalizedDrugs[i];
        const b = normalizedDrugs[j];
        for (const rule of DRUG_INTERACTIONS) {
          if (matchesPair(a.lc, b.lc, rule)) {
            warnings.push({
              kind: 'interaction',
              severity: rule.severity,
              matchedRule: rule,
              message: rule.description,
              triggers: i === j ? [a.raw] : [a.raw, b.raw],
            });
          }
        }
      }
    }

    // 2. Allerji ↔ reçete edilen ilaç substring match.
    for (const allergen of allergies) {
      for (const drug of normalizedDrugs) {
        if (drug.lc.includes(allergen) || allergen.includes(drug.lc.split(' ')[0])) {
          warnings.push({
            kind: 'allergy',
            severity: 'contraindicated',
            matchedRule: null,
            message: `Hasta '${allergen}' alerjisi bildirildi; '${drug.raw}' alternatifi gözden geçir.`,
            messageKey: 'errors.clinic.drugAllergy',
            messageParams: { allergen, drug: drug.raw },
            triggers: [drug.raw, allergen],
          });
        }
      }
    }

    // 3. Antikoagülan ↔ yeni ilaç. Hasta zaten warfarin/aspirin kullanıyor;
    // yeni reçetedeki ilaç (NSAID, vb.) ile etkileşim varsa drug interaction
    // kataloğundan bulunur.
    for (const anti of anticoagulants) {
      for (const drug of normalizedDrugs) {
        for (const rule of DRUG_INTERACTIONS) {
          if (matchesPair(anti, drug.lc, rule)) {
            // Mevcut interaction warning'ı zaten loop1'de eklendi — burada
            // ek context: hasta bunu zaten kullanıyor.
            const already = warnings.find(
              (w) =>
                w.kind === 'interaction' && w.matchedRule === rule && w.triggers.includes(drug.raw),
            );
            if (!already) {
              warnings.push({
                kind: 'anticoagulant',
                severity: rule.severity,
                matchedRule: rule,
                message: `Hasta zaten '${anti}' kullanıyor — '${drug.raw}' ile çatışma: ${rule.description}`,
                messageKey: 'errors.clinic.drugConflict',
                messageParams: { existing: anti, drug: drug.raw, detail: rule.description },
                triggers: [drug.raw, anti],
              });
            }
          }
        }
      }
    }

    return dedupe(warnings);
  }
}

function matchesPair(a: string, b: string, rule: DrugInteractionRule): boolean {
  const ra = rule.drugA.toLowerCase();
  const rb = rule.drugB.toLowerCase();
  // Commutative: (a→ra && b→rb) veya (a→rb && b→ra)
  return (a.includes(ra) && b.includes(rb)) || (a.includes(rb) && b.includes(ra));
}

function dedupe(warnings: InteractionWarning[]): InteractionWarning[] {
  const seen = new Set<string>();
  return warnings.filter((w) => {
    const key = `${w.kind}|${w.severity}|${w.triggers.join('|')}|${w.matchedRule?.drugA ?? ''}|${w.matchedRule?.drugB ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
