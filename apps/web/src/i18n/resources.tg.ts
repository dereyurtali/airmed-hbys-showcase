// #1056 — dil-başına resource paketi: yalnız aktif dil yüklenir.
// TR entry'de statik (fallback); RU/TG i18n/index.ts lazyLocaleBackend ile
// kendi chunk'ından ilk kullanımda gelir. Yeni namespace eklerken üç
// resources.<lng>.ts dosyasını ve index.ts 'ns' listesini birlikte güncelle.
import common from './locales/common.tg.json';
import auth from './locales/auth.tg.json';
import patient from './locales/patient.tg.json';
import doctor from './locales/doctor.tg.json';
import appointment from './locales/appointment.tg.json';
import examination from './locales/examination.tg.json';
import measurement from './locales/measurement.tg.json';
import clinical from './locales/clinical.tg.json';
import photo from './locales/photo.tg.json';
import dashboard from './locales/dashboard.tg.json';
import surgery from './locales/surgery.tg.json';
import lab from './locales/lab.tg.json';
import iol from './locales/iol.tg.json';
import postOp from './locales/postOp.tg.json';
import procedure from './locales/procedure.tg.json';
import preOp from './locales/preOp.tg.json';
import reports from './locales/reports.tg.json';
import pharmacy from './locales/pharmacy.tg.json';
import commission from './locales/commission.tg.json';
import fraud from './locales/fraud.tg.json';
import consent from './locales/consent.tg.json';
import messaging from './locales/messaging.tg.json';
import billing from './locales/billing.tg.json';
import notification from './locales/notification.tg.json';
import worklist from './locales/worklist.tg.json';
import measurementOrder from './locales/measurementOrder.tg.json';
import surgerySales from './locales/surgerySales.tg.json';
import feedback from './locales/feedback.tg.json';
import receptionQueue from './locales/receptionQueue.tg.json';
import safety from './locales/safety.tg.json';
import encounter from './locales/encounter.tg.json';
import nurse from './locales/nurse.tg.json';
import recall from './locales/recall.tg.json';
import cosign from './locales/cosign.tg.json';
import pastExaminations from './locales/pastExaminations.tg.json';
import setup from './locales/setup.tg.json';
import guide from './locales/guide.tg.json';

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
