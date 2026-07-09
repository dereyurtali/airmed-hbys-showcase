// #1056 — dil-başına resource paketi: yalnız aktif dil yüklenir.
// TR entry'de statik (fallback); RU/TG i18n/index.ts lazyLocaleBackend ile
// kendi chunk'ından ilk kullanımda gelir. Yeni namespace eklerken üç
// resources.<lng>.ts dosyasını ve index.ts 'ns' listesini birlikte güncelle.
import common from './locales/common.ru.json';
import auth from './locales/auth.ru.json';
import patient from './locales/patient.ru.json';
import doctor from './locales/doctor.ru.json';
import appointment from './locales/appointment.ru.json';
import examination from './locales/examination.ru.json';
import measurement from './locales/measurement.ru.json';
import clinical from './locales/clinical.ru.json';
import photo from './locales/photo.ru.json';
import dashboard from './locales/dashboard.ru.json';
import surgery from './locales/surgery.ru.json';
import lab from './locales/lab.ru.json';
import iol from './locales/iol.ru.json';
import postOp from './locales/postOp.ru.json';
import procedure from './locales/procedure.ru.json';
import preOp from './locales/preOp.ru.json';
import reports from './locales/reports.ru.json';
import pharmacy from './locales/pharmacy.ru.json';
import commission from './locales/commission.ru.json';
import fraud from './locales/fraud.ru.json';
import consent from './locales/consent.ru.json';
import messaging from './locales/messaging.ru.json';
import billing from './locales/billing.ru.json';
import notification from './locales/notification.ru.json';
import worklist from './locales/worklist.ru.json';
import measurementOrder from './locales/measurementOrder.ru.json';
import surgerySales from './locales/surgerySales.ru.json';
import feedback from './locales/feedback.ru.json';
import receptionQueue from './locales/receptionQueue.ru.json';
import safety from './locales/safety.ru.json';
import encounter from './locales/encounter.ru.json';
import nurse from './locales/nurse.ru.json';
import recall from './locales/recall.ru.json';
import cosign from './locales/cosign.ru.json';
import pastExaminations from './locales/pastExaminations.ru.json';
import setup from './locales/setup.ru.json';
import guide from './locales/guide.ru.json';

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
