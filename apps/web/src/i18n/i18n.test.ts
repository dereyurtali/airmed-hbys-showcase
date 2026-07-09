import { describe, expect, it } from 'vitest';
import commonTr from './locales/common.tr.json';
import commonRu from './locales/common.ru.json';
import commonTg from './locales/common.tg.json';
import authTr from './locales/auth.tr.json';
import authRu from './locales/auth.ru.json';
import authTg from './locales/auth.tg.json';
import patientTr from './locales/patient.tr.json';
import patientRu from './locales/patient.ru.json';
import patientTg from './locales/patient.tg.json';
import doctorTr from './locales/doctor.tr.json';
import doctorRu from './locales/doctor.ru.json';
import doctorTg from './locales/doctor.tg.json';
import billingTr from './locales/billing.tr.json';
import billingRu from './locales/billing.ru.json';
import billingTg from './locales/billing.tg.json';
import notificationTr from './locales/notification.tr.json';
import notificationRu from './locales/notification.ru.json';
import notificationTg from './locales/notification.tg.json';
import worklistTr from './locales/worklist.tr.json';
import worklistRu from './locales/worklist.ru.json';
import worklistTg from './locales/worklist.tg.json';
import measurementOrderTr from './locales/measurementOrder.tr.json';
import measurementOrderRu from './locales/measurementOrder.ru.json';
import measurementOrderTg from './locales/measurementOrder.tg.json';
import surgerySalesTr from './locales/surgerySales.tr.json';
import surgerySalesRu from './locales/surgerySales.ru.json';
import surgerySalesTg from './locales/surgerySales.tg.json';
import feedbackTr from './locales/feedback.tr.json';
import feedbackRu from './locales/feedback.ru.json';
import feedbackTg from './locales/feedback.tg.json';
import receptionQueueTr from './locales/receptionQueue.tr.json';
import receptionQueueRu from './locales/receptionQueue.ru.json';
import receptionQueueTg from './locales/receptionQueue.tg.json';
import pastExaminationsTr from './locales/pastExaminations.tr.json';
import pastExaminationsRu from './locales/pastExaminations.ru.json';
import pastExaminationsTg from './locales/pastExaminations.tg.json';
import iolTr from './locales/iol.tr.json';
import iolRu from './locales/iol.ru.json';
import iolTg from './locales/iol.tg.json';
import labTr from './locales/lab.tr.json';
import labRu from './locales/lab.ru.json';
import labTg from './locales/lab.tg.json';
import cosignTr from './locales/cosign.tr.json';
import cosignRu from './locales/cosign.ru.json';
import cosignTg from './locales/cosign.tg.json';
import appointmentTr from './locales/appointment.tr.json';
import appointmentRu from './locales/appointment.ru.json';
import appointmentTg from './locales/appointment.tg.json';
import commissionTr from './locales/commission.tr.json';
import commissionRu from './locales/commission.ru.json';
import commissionTg from './locales/commission.tg.json';
import consentTr from './locales/consent.tr.json';
import consentRu from './locales/consent.ru.json';
import consentTg from './locales/consent.tg.json';
import dashboardTr from './locales/dashboard.tr.json';
import dashboardRu from './locales/dashboard.ru.json';
import dashboardTg from './locales/dashboard.tg.json';
import encounterTr from './locales/encounter.tr.json';
import encounterRu from './locales/encounter.ru.json';
import encounterTg from './locales/encounter.tg.json';
import examinationTr from './locales/examination.tr.json';
import examinationRu from './locales/examination.ru.json';
import examinationTg from './locales/examination.tg.json';
import fraudTr from './locales/fraud.tr.json';
import fraudRu from './locales/fraud.ru.json';
import fraudTg from './locales/fraud.tg.json';
import measurementTr from './locales/measurement.tr.json';
import measurementRu from './locales/measurement.ru.json';
import measurementTg from './locales/measurement.tg.json';
import messagingTr from './locales/messaging.tr.json';
import messagingRu from './locales/messaging.ru.json';
import messagingTg from './locales/messaging.tg.json';
import nurseTr from './locales/nurse.tr.json';
import nurseRu from './locales/nurse.ru.json';
import nurseTg from './locales/nurse.tg.json';
import pharmacyTr from './locales/pharmacy.tr.json';
import pharmacyRu from './locales/pharmacy.ru.json';
import pharmacyTg from './locales/pharmacy.tg.json';
import photoTr from './locales/photo.tr.json';
import photoRu from './locales/photo.ru.json';
import photoTg from './locales/photo.tg.json';
import postOpTr from './locales/postOp.tr.json';
import postOpRu from './locales/postOp.ru.json';
import postOpTg from './locales/postOp.tg.json';
import preOpTr from './locales/preOp.tr.json';
import preOpRu from './locales/preOp.ru.json';
import preOpTg from './locales/preOp.tg.json';
import procedureTr from './locales/procedure.tr.json';
import procedureRu from './locales/procedure.ru.json';
import procedureTg from './locales/procedure.tg.json';
import recallTr from './locales/recall.tr.json';
import recallRu from './locales/recall.ru.json';
import recallTg from './locales/recall.tg.json';
import reportsTr from './locales/reports.tr.json';
import reportsRu from './locales/reports.ru.json';
import reportsTg from './locales/reports.tg.json';
import safetyTr from './locales/safety.tr.json';
import safetyRu from './locales/safety.ru.json';
import safetyTg from './locales/safety.tg.json';
import setupTr from './locales/setup.tr.json';
import setupRu from './locales/setup.ru.json';
import setupTg from './locales/setup.tg.json';
import surgeryTr from './locales/surgery.tr.json';
import surgeryRu from './locales/surgery.ru.json';
import surgeryTg from './locales/surgery.tg.json';

const NAMESPACES = {
  common: { tr: commonTr, ru: commonRu, tg: commonTg },
  auth: { tr: authTr, ru: authRu, tg: authTg },
  patient: { tr: patientTr, ru: patientRu, tg: patientTg },
  doctor: { tr: doctorTr, ru: doctorRu, tg: doctorTg },
  // S11d billing — TR/RU/TG parity koruması
  billing: { tr: billingTr, ru: billingRu, tg: billingTg },
  // S15b notification — TR/RU/TG parity koruması
  notification: { tr: notificationTr, ru: notificationRu, tg: notificationTg },
  // S15 worklist — TR/RU/TG parity koruması
  worklist: { tr: worklistTr, ru: worklistRu, tg: worklistTg },
  measurementOrder: { tr: measurementOrderTr, ru: measurementOrderRu, tg: measurementOrderTg },
  surgerySales: { tr: surgerySalesTr, ru: surgerySalesRu, tg: surgerySalesTg },
  feedback: { tr: feedbackTr, ru: feedbackRu, tg: feedbackTg },
  receptionQueue: { tr: receptionQueueTr, ru: receptionQueueRu, tg: receptionQueueTg },
  pastExaminations: { tr: pastExaminationsTr, ru: pastExaminationsRu, tg: pastExaminationsTg },
  // S15 stok tahmin + lab eşik + co-sign — TR/RU/TG parity koruması (delta audit D-1)
  iol: { tr: iolTr, ru: iolRu, tg: iolTg },
  lab: { tr: labTr, ru: labRu, tg: labTg },
  cosign: { tr: cosignTr, ru: cosignRu, tg: cosignTg },
  appointment: { tr: appointmentTr, ru: appointmentRu, tg: appointmentTg },
  commission: { tr: commissionTr, ru: commissionRu, tg: commissionTg },
  consent: { tr: consentTr, ru: consentRu, tg: consentTg },
  dashboard: { tr: dashboardTr, ru: dashboardRu, tg: dashboardTg },
  encounter: { tr: encounterTr, ru: encounterRu, tg: encounterTg },
  examination: { tr: examinationTr, ru: examinationRu, tg: examinationTg },
  fraud: { tr: fraudTr, ru: fraudRu, tg: fraudTg },
  measurement: { tr: measurementTr, ru: measurementRu, tg: measurementTg },
  messaging: { tr: messagingTr, ru: messagingRu, tg: messagingTg },
  nurse: { tr: nurseTr, ru: nurseRu, tg: nurseTg },
  pharmacy: { tr: pharmacyTr, ru: pharmacyRu, tg: pharmacyTg },
  photo: { tr: photoTr, ru: photoRu, tg: photoTg },
  postOp: { tr: postOpTr, ru: postOpRu, tg: postOpTg },
  preOp: { tr: preOpTr, ru: preOpRu, tg: preOpTg },
  procedure: { tr: procedureTr, ru: procedureRu, tg: procedureTg },
  recall: { tr: recallTr, ru: recallRu, tg: recallTg },
  reports: { tr: reportsTr, ru: reportsRu, tg: reportsTg },
  safety: { tr: safetyTr, ru: safetyRu, tg: safetyTg },
  setup: { tr: setupTr, ru: setupRu, tg: setupTg },
  surgery: { tr: surgeryTr, ru: surgeryRu, tg: surgeryTg },
} as const;

// i18next plural suffix'leri (_one, _few, _many, _other, _zero, _two) dil-bazlı
// farklı olabilir (RU 4 form, TR/TG 2 form). Anahtar shape karşılaştırmasında
// "base key" düzeyinde eşit olmasını isteriz, plural form sayısı dile bağlıdır.
const PLURAL_SUFFIX_RE = /_(zero|one|two|few|many|other)$/;

function normalizePluralSuffix(key: string): string {
  return key.replace(PLURAL_SUFFIX_RE, '_*');
}

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const child of flattenKeys(v as Record<string, unknown>, full)) {
        keys.add(child);
      }
    } else {
      keys.add(normalizePluralSuffix(full));
    }
  }
  return Array.from(keys).sort();
}

describe('i18n resources', () => {
  for (const [ns, dicts] of Object.entries(NAMESPACES)) {
    it(`${ns}: TR/RU/TG share the same key shape`, () => {
      const tr = flattenKeys(dicts.tr as Record<string, unknown>);
      const ru = flattenKeys(dicts.ru as Record<string, unknown>);
      const tg = flattenKeys(dicts.tg as Record<string, unknown>);
      expect(ru).toEqual(tr);
      expect(tg).toEqual(tr);
    });

    it(`${ns}: every value is a non-empty string`, () => {
      for (const [code, dict] of Object.entries(dicts)) {
        const empty = collectEmpty(dict as Record<string, unknown>);
        expect(empty, `${ns}/${code} has empty leaves: ${empty.join(', ')}`).toEqual([]);
      }
    });
  }

  it('Tajik covers all special Cyrillic characters used in clinic vocabulary', () => {
    // Inter Cyrillic subset must render Ӣ Қ Ҳ Ҷ Ӯ Ғ — we ensure at least
    // some of these appear in the Tajik bundles, so a missing-glyph regression
    // would surface as a failing string match rather than silent boxes.
    const allTg = JSON.stringify({
      common: commonTg,
      auth: authTg,
      patient: patientTg,
      doctor: doctorTg,
    });
    // Each pair = upper/lowercase; we only need one variant to appear, since
    // case usage depends on the surrounding string (sentence-initial vs. mid-word).
    // v0.4 İP-24 (#560) — issue'nun saydığı 6 özel harfin TAMAMI (Ӣ Қ Ҳ Ҷ Ӯ Ғ).
    const tajikSpecific: [string, string][] = [
      ['Ӯ', 'ӯ'],
      ['Ҳ', 'ҳ'],
      ['Ҷ', 'ҷ'],
      ['Ӣ', 'ӣ'],
      ['Қ', 'қ'],
      ['Ғ', 'ғ'],
    ];
    for (const [upper, lower] of tajikSpecific) {
      const present = allTg.includes(upper) || allTg.includes(lower);
      expect(present, `Expected ${upper}/${lower} somewhere in TG bundles`).toBe(true);
    }
  });
});

function collectEmpty(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...collectEmpty(v as Record<string, unknown>, full));
    } else if (typeof v !== 'string' || v.length === 0) {
      out.push(full);
    }
  }
  return out;
}
