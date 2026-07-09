// D1 — Default trigger seed (22 trigger key) + TR template seed.
//
// Tenant ilk açıldığında veya migration sonrası `ensureDefaults(tenantId)`
// çağrısıyla bu liste idempotent upsert edilir (fraud rule pattern'i).
//
// RU/TG çevirileri A16 PR'larında doldurulacak; pilot için TR yeterli.

import type { MessageChannel, MessageLanguage, TriggerCategory } from './messaging.types';

interface TriggerDefault {
  key: string;
  category: TriggerCategory;
  name: string;
  isEnabled: boolean;
  isMandatory?: boolean;
  channels: MessageChannel[];
  quietHoursStart?: number;
  quietHoursEnd?: number;
}

export const TRIGGER_DEFAULTS: TriggerDefault[] = [
  // ---- RANDEVU (7) ----
  {
    key: 'APPOINTMENT_CONFIRMATION',
    category: 'RANDEVU',
    name: 'Randevu Onayı',
    isEnabled: true,
    channels: ['MOCK'],
  },
  {
    key: 'APPOINTMENT_REMINDER_24H',
    category: 'RANDEVU',
    name: '24 Saat Önce Hatırlatma',
    isEnabled: true,
    channels: ['MOCK'],
  },
  {
    key: 'APPOINTMENT_REMINDER_2H',
    category: 'RANDEVU',
    name: '2 Saat Önce Hatırlatma',
    isEnabled: false,
    channels: ['MOCK'],
  },
  {
    key: 'APPOINTMENT_RESCHEDULED',
    category: 'RANDEVU',
    name: 'Randevu Değişti',
    isEnabled: true,
    channels: ['MOCK'],
  },
  {
    key: 'APPOINTMENT_CANCELLED',
    category: 'RANDEVU',
    name: 'Randevu İptal',
    isEnabled: true,
    channels: ['MOCK'],
  },
  {
    key: 'NO_SHOW_FOLLOWUP',
    category: 'RANDEVU',
    name: 'Gelmeyene Yeniden Davet',
    isEnabled: false,
    channels: ['MOCK'],
  },
  {
    key: 'POST_OP_CONTROL_REMINDER_24H',
    category: 'RANDEVU',
    name: 'Post-Op Kontrol 24sa Hatırlatma',
    isEnabled: true,
    channels: ['MOCK'],
  },
  // S15-PR24 — Yeni post-op trigger'ları: 1. gün, taburcu sonrası ilaç.
  {
    key: 'POST_OP_DAY1_CHECKUP',
    category: 'RANDEVU',
    name: 'Post-Op 1. Gün Kontrol',
    isEnabled: true,
    channels: ['MOCK'],
  },
  {
    key: 'POST_OP_DISCHARGE_MEDS',
    category: 'TETKIK',
    name: 'Taburcu Sonrası İlaç Hatırlatma',
    isEnabled: true,
    channels: ['MOCK'],
    quietHoursStart: 22,
    quietHoursEnd: 7,
  },
  // ---- TETKIK (3) ----
  {
    key: 'EXAMINATION_RESULT_READY',
    category: 'TETKIK',
    name: 'Tetkik Sonucu Hazır',
    isEnabled: true,
    channels: ['MOCK'],
  },
  {
    key: 'PRE_OP_TEST_PREPARATION',
    category: 'TETKIK',
    name: 'Tetkik Öncesi Hazırlık',
    isEnabled: true,
    channels: ['MOCK'],
  },
  {
    key: 'MEDICATION_REMINDER',
    category: 'TETKIK',
    name: 'İlaç/Damla Hatırlatma',
    isEnabled: true,
    channels: ['MOCK'],
    quietHoursStart: 22,
    quietHoursEnd: 7,
  },
  // ---- FATURA (4) ----
  {
    key: 'INVOICE_ISSUED',
    category: 'FATURA',
    name: 'Fatura Kesildi (dış event)',
    isEnabled: false,
    channels: ['MOCK'],
  },
  {
    key: 'PAYMENT_OVERDUE',
    category: 'FATURA',
    name: 'Ödeme Gecikti',
    isEnabled: false,
    channels: ['MOCK'],
  },
  {
    key: 'PRE_PAYMENT_REQUIRED',
    category: 'FATURA',
    name: 'Ön Ödeme Talebi',
    isEnabled: true,
    channels: ['MOCK'],
  },
  {
    key: 'PRE_PAYMENT_RECEIVED',
    category: 'FATURA',
    name: 'Ön Ödeme Alındı',
    isEnabled: true,
    channels: ['MOCK'],
  },
  // ---- ONAM (3) ----
  {
    key: 'CONSENT_NEEDED',
    category: 'ONAM',
    name: 'Onam İmza Talebi',
    isEnabled: true,
    channels: ['MOCK'],
  },
  {
    key: 'CONSENT_SIGNED',
    category: 'ONAM',
    name: 'Onam İmzalandı',
    isEnabled: true,
    channels: ['MOCK'],
  },
  {
    key: 'CONSENT_PDF_SHARED',
    category: 'ONAM',
    name: 'İmzalı PDF Paylaş (gizlilik)',
    isEnabled: false,
    channels: ['MOCK'],
  },
  // ---- DIGER (5) ----
  {
    key: 'COMPLICATION_DOCTOR_ALERT',
    category: 'DIGER',
    name: '🔴 Komplikasyon Cerraha (KAPATILAMAZ)',
    isEnabled: true,
    isMandatory: true,
    channels: ['MOCK'],
  },
  {
    key: 'LENS_ARRIVAL_NOTICE',
    category: 'DIGER',
    name: 'Lens Geldi (iç)',
    isEnabled: true,
    channels: ['MOCK'],
  },
  {
    key: 'LOW_STOCK_ALERT',
    category: 'DIGER',
    name: 'Düşük Stok Uyarısı',
    isEnabled: true,
    channels: ['MOCK'],
  },
  {
    key: 'VISITING_WINDOW_CLOSING',
    category: 'DIGER',
    name: 'Visiting Profesör Pencere Kapanıyor',
    isEnabled: true,
    channels: ['MOCK'],
  },
  {
    key: 'NEW_PATIENT_WELCOME',
    category: 'DIGER',
    name: 'Yeni Hasta Hoşgeldin',
    isEnabled: false,
    channels: ['MOCK'],
  },
];

// TR template seed — her trigger için varsayılan body.
// Handlebars syntax: {{patientName}} vb. Whitelist `variables` field'ında.
interface TemplateDefault {
  triggerKey: string;
  language: MessageLanguage;
  channelType: MessageChannel;
  subject: string | null;
  body: string;
  variables: string[];
}

export const TEMPLATE_DEFAULTS_TR: TemplateDefault[] = [
  {
    triggerKey: 'APPOINTMENT_CONFIRMATION',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Randevunuz onaylandı',
    body: 'Sayın {{patientName}}, {{appointmentDate}} tarihinde Dr. {{doctorName}} ile randevunuz onaylandı.',
    variables: ['patientName', 'appointmentDate', 'doctorName'],
  },
  {
    triggerKey: 'APPOINTMENT_REMINDER_24H',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Randevu hatırlatması',
    body: 'Sayın {{patientName}}, yarın {{appointmentTime}} saatinde Dr. {{doctorName}} ile randevunuz var.',
    variables: ['patientName', 'appointmentTime', 'doctorName'],
  },
  {
    triggerKey: 'APPOINTMENT_RESCHEDULED',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Randevu değişti',
    body: 'Sayın {{patientName}}, randevunuz {{newDate}} tarihine alındı.',
    variables: ['patientName', 'newDate'],
  },
  {
    triggerKey: 'APPOINTMENT_CANCELLED',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Randevu iptal',
    body: 'Sayın {{patientName}}, {{appointmentDate}} tarihindeki randevunuz iptal edildi.',
    variables: ['patientName', 'appointmentDate'],
  },
  {
    triggerKey: 'POST_OP_CONTROL_REMINDER_24H',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Kontrol randevusu',
    body: 'Sayın {{patientName}}, yarın {{controlTime}} saatinde post-op kontrolünüz var.',
    variables: ['patientName', 'controlTime'],
  },
  {
    triggerKey: 'EXAMINATION_RESULT_READY',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Tetkik sonucu hazır',
    body: 'Sayın {{patientName}}, {{examName}} sonucunuz hazır. Doktor önerisi için randevu alın.',
    variables: ['patientName', 'examName'],
  },
  {
    triggerKey: 'PRE_OP_TEST_PREPARATION',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Tetkik öncesi hazırlık',
    body: 'Sayın {{patientName}}, {{examName}} için {{instructions}}',
    variables: ['patientName', 'examName', 'instructions'],
  },
  {
    triggerKey: 'MEDICATION_REMINDER',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'İlaç hatırlatması',
    body: 'Sayın {{patientName}}, {{medicationName}} damlasını {{dosage}} alma vaktiniz.',
    variables: ['patientName', 'medicationName', 'dosage'],
  },
  {
    triggerKey: 'PRE_PAYMENT_REQUIRED',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Ön ödeme talebi',
    body: 'Sayın {{patientName}}, {{procedureName}} için ön ödeme tutarı: {{amount}}.',
    variables: ['patientName', 'procedureName', 'amount'],
  },
  {
    triggerKey: 'PRE_PAYMENT_RECEIVED',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Ön ödeme alındı',
    body: 'Sayın {{patientName}}, ön ödemeniz alındı. Makbuz no: {{receiptNo}}.',
    variables: ['patientName', 'receiptNo'],
  },
  {
    triggerKey: 'CONSENT_NEEDED',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Onam imza talebi',
    body: 'Sayın {{patientName}}, {{procedureName}} için onam imzanız bekleniyor.',
    variables: ['patientName', 'procedureName'],
  },
  {
    triggerKey: 'CONSENT_SIGNED',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Onam tamamlandı',
    body: 'Sayın {{patientName}}, onam formunuz tamamlandı. Teşekkürler.',
    variables: ['patientName'],
  },
  {
    triggerKey: 'COMPLICATION_DOCTOR_ALERT',
    language: 'tr',
    channelType: 'MOCK',
    subject: '🔴 Komplikasyon Bildirimi',
    body: 'Dr. {{doctorName}}, {{patientName}} cerrahisinde {{severity}} komplikasyon: {{description}}',
    variables: ['doctorName', 'patientName', 'severity', 'description'],
  },
  {
    triggerKey: 'LENS_ARRIVAL_NOTICE',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Lens geldi',
    body: '{{lensModel}} ({{quantity}} adet) kliniğe ulaştı. Lot: {{lotNumber}}.',
    variables: ['lensModel', 'quantity', 'lotNumber'],
  },
  {
    triggerKey: 'LOW_STOCK_ALERT',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Düşük stok uyarısı',
    body: '{{itemName}} stoğu {{remaining}} adet kaldı. Sipariş gerekli.',
    variables: ['itemName', 'remaining'],
  },
  {
    triggerKey: 'VISITING_WINDOW_CLOSING',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Visiting pencere kapanıyor',
    body: 'Dr. {{visitingName}} window {{endDate}} tarihinde kapanıyor. Randevu planlayın.',
    variables: ['visitingName', 'endDate'],
  },
  // S15-PR24 — Yeni post-op SMS şablonları (TR).
  {
    triggerKey: 'POST_OP_DAY1_CHECKUP',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'Yarın kontrol',
    body: 'Sayın {{patientName}}, ameliyat sonrası 1. gün kontrolünüz yarın {{controlTime}}.',
    variables: ['patientName', 'controlTime'],
  },
  {
    triggerKey: 'POST_OP_DISCHARGE_MEDS',
    language: 'tr',
    channelType: 'MOCK',
    subject: 'İlaç hatırlatma',
    body: 'Sayın {{patientName}}, taburcu sonrası ilaçlarınızı yarın {{morningTime}} ve {{eveningTime}} saatlerinde almayı unutmayın.',
    variables: ['patientName', 'morningTime', 'eveningTime'],
  },
];

// S15-PR24 — Çok dilli post-op şablonlar (RU + TG). 3 dil sözleşme gereği.
// Mevcut TR-only şablonlar pilot sırasında runtime'da extend edilir; burada
// post-op'a özel yenileri seed'lenir.
export const POST_OP_TEMPLATES_MULTI_LANG: TemplateDefault[] = [
  // POST_OP_CONTROL_REMINDER_24H — RU + TG
  {
    triggerKey: 'POST_OP_CONTROL_REMINDER_24H',
    language: 'ru',
    channelType: 'MOCK',
    subject: 'Контрольный приём',
    body: 'Уважаемый(ая) {{patientName}}, завтра в {{controlTime}} ваш пост-оп контроль.',
    variables: ['patientName', 'controlTime'],
  },
  {
    triggerKey: 'POST_OP_CONTROL_REMINDER_24H',
    language: 'tg',
    channelType: 'MOCK',
    subject: 'Назорати пасоҷарроҳӣ',
    body: 'Эҳтиромгузор {{patientName}}, фардо соати {{controlTime}} назорати пасоҷарроҳии шумо муқаррар шудааст.',
    variables: ['patientName', 'controlTime'],
  },
  // POST_OP_DAY1_CHECKUP — RU + TG
  {
    triggerKey: 'POST_OP_DAY1_CHECKUP',
    language: 'ru',
    channelType: 'MOCK',
    subject: 'Контроль завтра',
    body: 'Уважаемый(ая) {{patientName}}, контроль на 1-й день после операции завтра в {{controlTime}}.',
    variables: ['patientName', 'controlTime'],
  },
  {
    triggerKey: 'POST_OP_DAY1_CHECKUP',
    language: 'tg',
    channelType: 'MOCK',
    subject: 'Назорати рӯзи 1',
    body: 'Эҳтиромгузор {{patientName}}, назорати рӯзи 1-уми пасоҷарроҳӣ фардо соати {{controlTime}}.',
    variables: ['patientName', 'controlTime'],
  },
  // POST_OP_DISCHARGE_MEDS — RU + TG
  {
    triggerKey: 'POST_OP_DISCHARGE_MEDS',
    language: 'ru',
    channelType: 'MOCK',
    subject: 'Напоминание о препаратах',
    body: 'Уважаемый(ая) {{patientName}}, не забудьте принять препараты завтра в {{morningTime}} и {{eveningTime}}.',
    variables: ['patientName', 'morningTime', 'eveningTime'],
  },
  {
    triggerKey: 'POST_OP_DISCHARGE_MEDS',
    language: 'tg',
    channelType: 'MOCK',
    subject: 'Ёдоварии доруҳо',
    body: 'Эҳтиромгузор {{patientName}}, фардо соати {{morningTime}} ва {{eveningTime}} гирифтани доруҳоро фаромӯш накунед.',
    variables: ['patientName', 'morningTime', 'eveningTime'],
  },
];
