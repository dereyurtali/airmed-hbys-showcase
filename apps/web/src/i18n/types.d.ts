import 'react-i18next';
import type commonTr from './locales/common.tr.json';
import type authTr from './locales/auth.tr.json';
import type patientTr from './locales/patient.tr.json';
import type doctorTr from './locales/doctor.tr.json';

declare module 'react-i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof commonTr;
      auth: typeof authTr;
      patient: typeof patientTr;
      doctor: typeof doctorTr;
    };
  }
}
