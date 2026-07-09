// E4 ICD-10 — oftalmik tanı kod listesi.
//
// Tenant-bağımsız, hardcoded — küçük (~50 kod), TR/RU/TG etiketli. Klinik
// özel kod gerekirse ileri PR'da tenant-scoped IcdCode table eklenir.
// Examination.findings JSONB içinde `{ icd10: ['H25.0', ...] }` olarak
// saklanır; bu liste UI autocomplete + chip render için kaynak.

export interface IcdCode {
  code: string; // ICD-10 (örn. "H25.0")
  category:
    | 'cornea'
    | 'lens'
    | 'retina'
    | 'glaucoma'
    | 'refractive'
    | 'inflammation'
    | 'trauma'
    | 'other';
  tr: string;
  ru: string;
  tg: string;
}

export const ICD10_CODES: readonly IcdCode[] = [
  // Lens / katarakt
  {
    code: 'H25.0',
    category: 'lens',
    tr: 'Yaşlılık kataraktı, başlangıç',
    ru: 'Старческая катаракта, начальная',
    tg: 'Катарактаи пиронсолӣ, ибтидоӣ',
  },
  {
    code: 'H25.1',
    category: 'lens',
    tr: 'Yaşlılık kataraktı, nüklear',
    ru: 'Старческая катаракта, ядерная',
    tg: 'Катарактаи пиронсолӣ, ҳаставӣ',
  },
  {
    code: 'H25.2',
    category: 'lens',
    tr: 'Yaşlılık kataraktı, Morgagni',
    ru: 'Старческая катаракта Морганьи',
    tg: 'Катарактаи Морганьи',
  },
  {
    code: 'H25.9',
    category: 'lens',
    tr: 'Yaşlılık kataraktı, tanımsız',
    ru: 'Старческая катаракта неуточнённая',
    tg: 'Катарактаи пиронсолӣ, номуайян',
  },
  {
    code: 'H26.0',
    category: 'lens',
    tr: 'İnfantil katarakt',
    ru: 'Инфантильная катаракта',
    tg: 'Катарактаи кӯдакӣ',
  },
  {
    code: 'H26.4',
    category: 'lens',
    tr: 'Sekonder katarakt',
    ru: 'Вторичная катаракта',
    tg: 'Катарактаи дуюмдараҷа',
  },
  { code: 'H27.0', category: 'lens', tr: 'Afaki', ru: 'Афакия', tg: 'Афакия' },
  {
    code: 'H27.1',
    category: 'lens',
    tr: 'Lens çıkığı',
    ru: 'Вывих хрусталика',
    tg: 'Деформацияи линза',
  },

  // Kornea
  {
    code: 'H16.0',
    category: 'cornea',
    tr: 'Kornea ülseri',
    ru: 'Язва роговицы',
    tg: 'Захми қарния',
  },
  {
    code: 'H16.2',
    category: 'cornea',
    tr: 'Keratokonjonktivit',
    ru: 'Кератоконъюнктивит',
    tg: 'Кератоконъюнктивит',
  },
  {
    code: 'H17.0',
    category: 'cornea',
    tr: 'Adheran lökom',
    ru: 'Адгезивная лейкома',
    tg: 'Лейкомаи часпак',
  },
  {
    code: 'H18.4',
    category: 'cornea',
    tr: 'Kornea dejenerasyonu',
    ru: 'Дегенерация роговицы',
    tg: 'Деғенератсияи қарния',
  },
  { code: 'H18.6', category: 'cornea', tr: 'Keratokonus', ru: 'Кератоконус', tg: 'Кератоконус' },

  // Retina
  {
    code: 'H33.0',
    category: 'retina',
    tr: 'Retina yırtığı ile ablasyon',
    ru: 'Отслойка сетчатки с разрывом',
    tg: 'Ҷудошавии торро бо канда шудан',
  },
  {
    code: 'H33.2',
    category: 'retina',
    tr: 'Seröz retina ablasyonu',
    ru: 'Серозная отслойка сетчатки',
    tg: 'Ҷудошавии серозии торро',
  },
  {
    code: 'H34.8',
    category: 'retina',
    tr: 'Retina ven oklüzyonu',
    ru: 'Окклюзия вены сетчатки',
    tg: 'Бастани раги торро',
  },
  {
    code: 'H35.0',
    category: 'retina',
    tr: 'Hipertansif retinopati',
    ru: 'Гипертоническая ретинопатия',
    tg: 'Ретинопатияи гипертоникӣ',
  },
  {
    code: 'H35.3',
    category: 'retina',
    tr: 'Yaşa bağlı makula dejenerasyonu',
    ru: 'Возрастная макулярная дегенерация',
    tg: 'Деғенератсияи синнусолии макула',
  },
  {
    code: 'H36.0',
    category: 'retina',
    tr: 'Diyabetik retinopati',
    ru: 'Диабетическая ретинопатия',
    tg: 'Ретинопатияи диабетикӣ',
  },

  // Glokom
  {
    code: 'H40.0',
    category: 'glaucoma',
    tr: 'Glokom şüphesi',
    ru: 'Подозрение на глаукому',
    tg: 'Шубҳаи глаукома',
  },
  {
    code: 'H40.1',
    category: 'glaucoma',
    tr: 'Primer açık açılı glokom',
    ru: 'Первичная открытоугольная глаукома',
    tg: 'Глаукомаи аввалияи кушодакунҷа',
  },
  {
    code: 'H40.2',
    category: 'glaucoma',
    tr: 'Primer kapalı açılı glokom',
    ru: 'Первичная закрытоугольная глаукома',
    tg: 'Глаукомаи аввалияи пӯшидакунҷа',
  },
  {
    code: 'H40.3',
    category: 'glaucoma',
    tr: 'Sekonder posttravmatik glokom',
    ru: 'Вторичная посттравматическая глаукома',
    tg: 'Глаукомаи дуюмдараҷаи посттравматикӣ',
  },
  {
    code: 'H42',
    category: 'glaucoma',
    tr: 'Glokom, başka hastalıklarda',
    ru: 'Глаукома при болезнях, классифицированных в других рубриках',
    tg: 'Глаукома дар бемориҳои дигар',
  },

  // Refraksiyon
  {
    code: 'H52.0',
    category: 'refractive',
    tr: 'Hipermetropi',
    ru: 'Гиперметропия',
    tg: 'Гиперметропия',
  },
  { code: 'H52.1', category: 'refractive', tr: 'Miyopi', ru: 'Миопия', tg: 'Миопия' },
  {
    code: 'H52.2',
    category: 'refractive',
    tr: 'Astigmatizm',
    ru: 'Астигматизм',
    tg: 'Астигматизм',
  },
  {
    code: 'H52.3',
    category: 'refractive',
    tr: 'Anizometropi',
    ru: 'Анизометропия',
    tg: 'Анизометропия',
  },
  { code: 'H52.4', category: 'refractive', tr: 'Presbiopi', ru: 'Пресбиопия', tg: 'Пресбиопия' },

  // İnflamasyon
  {
    code: 'H10.0',
    category: 'inflammation',
    tr: 'Mukopürülan konjonktivit',
    ru: 'Слизисто-гнойный конъюнктивит',
    tg: 'Конъюнктивити шиллу-чиркин',
  },
  {
    code: 'H10.1',
    category: 'inflammation',
    tr: 'Akut atopik konjonktivit',
    ru: 'Острый атопический конъюнктивит',
    tg: 'Конъюнктивити атопии шадид',
  },
  {
    code: 'H10.4',
    category: 'inflammation',
    tr: 'Kronik konjonktivit',
    ru: 'Хронический конъюнктивит',
    tg: 'Конъюнктивити музмин',
  },
  {
    code: 'H20.0',
    category: 'inflammation',
    tr: 'Akut iridosiklit',
    ru: 'Острый иридоциклит',
    tg: 'Иридосиклити шадид',
  },
  {
    code: 'H30.0',
    category: 'inflammation',
    tr: 'Fokal koriyoretinit',
    ru: 'Очаговый хориоретинит',
    tg: 'Хориоретинити маҳдуд',
  },

  // Travma
  {
    code: 'S05.0',
    category: 'trauma',
    tr: 'Konjonktiva yaralanması',
    ru: 'Повреждение конъюнктивы',
    tg: 'Осеби конъюнктива',
  },
  {
    code: 'S05.1',
    category: 'trauma',
    tr: 'Göz küresi kontüzyonu',
    ru: 'Ушиб глазного яблока',
    tg: 'Кӯбидани кураи чашм',
  },
  {
    code: 'S05.3',
    category: 'trauma',
    tr: 'Penetran göz yaralanması',
    ru: 'Проникающее ранение глаза',
    tg: 'Захми сӯрохикунанда',
  },
  {
    code: 'S05.5',
    category: 'trauma',
    tr: 'Yabancı cisim ile penetran yaralanma',
    ru: 'Проникающая травма с инородным телом',
    tg: 'Осеб бо ҷисми бегона',
  },
  {
    code: 'T15.0',
    category: 'trauma',
    tr: 'Korneada yabancı cisim',
    ru: 'Инородное тело в роговице',
    tg: 'Ҷисми бегона дар қарния',
  },
  {
    code: 'T15.1',
    category: 'trauma',
    tr: 'Konjonktiva sakkusunda yabancı cisim',
    ru: 'Инородное тело в конъюнктивальном мешке',
    tg: 'Ҷисми бегона дар халтаи конъюнктиваль',
  },

  // Diğer
  {
    code: 'H53.0',
    category: 'other',
    tr: 'Anopsi nedeniyle ambliyopi',
    ru: 'Амблиопия вследствие анопсии',
    tg: 'Амблиопияи аз анопсия',
  },
  {
    code: 'H53.4',
    category: 'other',
    tr: 'Görme alanı defekti',
    ru: 'Дефекты поля зрения',
    tg: 'Нуқсонҳои майдони биноӣ',
  },
  {
    code: 'H54.0',
    category: 'other',
    tr: 'İki taraflı körlük',
    ru: 'Слепота обоих глаз',
    tg: 'Кӯрии ҳарду чашм',
  },
  {
    code: 'H54.5',
    category: 'other',
    tr: 'Düşük görme, tek taraflı',
    ru: 'Слабовидение, одноглазое',
    tg: 'Дидаи паст, якчашма',
  },
  { code: 'H57.1', category: 'other', tr: 'Göz ağrısı', ru: 'Боль в глазу', tg: 'Дарди чашм' },
] as const;

const CODE_SET = new Set(ICD10_CODES.map((c) => c.code));

export function isValidIcdCode(code: string): boolean {
  return CODE_SET.has(code);
}
