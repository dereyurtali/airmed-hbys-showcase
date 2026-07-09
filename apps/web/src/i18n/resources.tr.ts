// #1056 — dil-başına resource paketi: yalnız aktif dil yüklenir.
// TR entry'de statik (fallback); RU/TG i18n/index.ts lazyLocaleBackend ile
// kendi chunk'ından ilk kullanımda gelir. Yeni namespace eklerken üç
// resources.<lng>.ts dosyasını ve index.ts 'ns' listesini birlikte güncelle.
import common from './locales/common.tr.json';
import auth from './locales/auth.tr.json';
import patient from './locales/patient.tr.json';
import doctor from './locales/doctor.tr.json';
import appointment from './locales/appointment.tr.json';
import examination from './locales/examination.tr.json';
import measurement from './locales/measurement.tr.json';
import clinical from './locales/clinical.tr.json';
import photo from './locales/photo.tr.json';
import dashboard from './locales/dashboard.tr.json';
import surgery from './locales/surgery.tr.json';
import lab from './locales/lab.tr.json';
import iol from './locales/iol.tr.json';
import postOp from './locales/postOp.tr.json';
import procedure from './locales/procedure.tr.json';
import preOp from './locales/preOp.tr.json';
import reports from './locales/reports.tr.json';
import pharmacy from './locales/pharmacy.tr.json';
import commission from './locales/commission.tr.json';
import fraud from './locales/fraud.tr.json';
import consent from './locales/consent.tr.json';
import messaging from './locales/messaging.tr.json';
import billing from './locales/billing.tr.json';
import notification from './locales/notification.tr.json';
import worklist from './locales/worklist.tr.json';
import measurementOrder from './locales/measurementOrder.tr.json';
import surgerySales from './locales/surgerySales.tr.json';
import feedback from './locales/feedback.tr.json';
import receptionQueue from './locales/receptionQueue.tr.json';
import safety from './locales/safety.tr.json';
import encounter from './locales/encounter.tr.json';
import nurse from './locales/nurse.tr.json';
import recall from './locales/recall.tr.json';
import cosign from './locales/cosign.tr.json';
import pastExaminations from './locales/pastExaminations.tr.json';
import setup from './locales/setup.tr.json';
import guide from './locales/guide.tr.json';

export default {
  common,
  auth,
  patient,
  doctor,
  appointment,
  examination,
  measurement,
  clinical,
  photo,
  dashboard,
  surgery,
  lab,
  iol,
  postOp,
  procedure,
  preOp,
  reports,
  pharmacy,
  commission,
  fraud,
  consent,
  messaging,
  billing,
  notification,
  worklist,
  measurementOrder,
  surgerySales,
  feedback,
  receptionQueue,
  safety,
  encounter,
  nurse,
  recall,
  cosign,
  pastExaminations,
  setup,
  guide,
};
