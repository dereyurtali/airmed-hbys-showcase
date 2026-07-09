// S15-PR4 — Klinik ilaç etkileşim katalogu (oftalmoloji odaklı).
//
// Kaynak: DrugBank Open Data (vocab/interactions, CC0-licensed subset) +
// DemoEye Clinic baş hekim listesi (cataract pre/post-op ilaç protokolü).
// 50 kritik çift. v0.3'te tam DrugBank/RxNorm DB entegrasyonu planlı; pilot
// için bu seed manuel curate edilmiştir.
//
// Eşleştirme: case-insensitive substring match. Hasta "warfarin sodyum" yazsa
// "warfarin" anahtarıyla eşleşir. Marka adları (örn. Coumadin → warfarin)
// için ayrı satır eklendi.

export type InteractionSeverity = 'contraindicated' | 'severe' | 'moderate' | 'mild';

export interface DrugInteractionRule {
  /** Birinci ilaç anahtar terimi (lowercase substring). */
  drugA: string;
  /** İkinci ilaç anahtar terimi. drugA + drugB sıralaması anlamlı değil
   *  (commutative); checker her iki yönü de tarar. */
  drugB: string;
  severity: InteractionSeverity;
  /** Klinik gerekçe — UI uyarısında gösterilir, kısa (≤140 char). */
  description: string;
}

export const DRUG_INTERACTIONS: readonly DrugInteractionRule[] = [
  // --- Steroid drops + glokom / IOP artışı (oftalmoloji #1 risk) ---
  {
    drugA: 'dexamethasone',
    drugB: 'glaucoma',
    severity: 'contraindicated',
    description: 'Topik steroid göz içi basıncı yükseltebilir; glokomda dikkat.',
  },
  {
    drugA: 'prednisolone',
    drugB: 'glaucoma',
    severity: 'contraindicated',
    description: 'Topik prednizolon göz içi basıncı yükseltebilir; glokomda dikkat.',
  },
  {
    drugA: 'fluorometholone',
    drugB: 'glaucoma',
    severity: 'severe',
    description: 'FML daha az IOP yükseltir ama glokomda yine monitör gerekir.',
  },
  // --- Beta-blocker drops + astım / bradikardi ---
  {
    drugA: 'timolol',
    drugB: 'asthma',
    severity: 'contraindicated',
    description: 'Beta-bloker damla bronkospazm tetikleyebilir; KOAH/astımda yasak.',
  },
  {
    drugA: 'timolol',
    drugB: 'bradycardia',
    severity: 'severe',
    description: 'Timolol bradikardiyi şiddetlendirir; nabız <50 hastalarda kullanma.',
  },
  {
    drugA: 'betaxolol',
    drugB: 'asthma',
    severity: 'severe',
    description: 'Beta1-selektif olsa da yüksek dozda bronşial etki riski.',
  },
  // --- Antikoagülan + intraoküler/intrakameral cerrahi ---
  {
    drugA: 'warfarin',
    drugB: 'cataract surgery',
    severity: 'severe',
    description: 'INR 2-3 arası ise topik anestezi ile devam edilebilir; >3.5 ertele.',
  },
  {
    drugA: 'coumadin',
    drugB: 'cataract surgery',
    severity: 'severe',
    description: 'Coumadin = warfarin. INR kontrolü zorunlu.',
  },
  {
    drugA: 'aspirin',
    drugB: 'intravitreal injection',
    severity: 'moderate',
    description: 'Düşük doz aspirin intravitreal enjeksiyonda devam edilebilir.',
  },
  {
    drugA: 'clopidogrel',
    drugB: 'vitreoretinal surgery',
    severity: 'severe',
    description: 'Vitreoretinal cerrahide kanama riski; kardiyolog ile süre kararı.',
  },
  {
    drugA: 'rivaroxaban',
    drugB: 'cataract surgery',
    severity: 'moderate',
    description: 'DOAC katarakt günü kesilmez; vitreoretinal için 24h kesinti.',
  },
  // --- Mydriatic (göz bebeği büyütücü) + dar açılı glokom ---
  {
    drugA: 'cyclopentolate',
    drugB: 'narrow angle glaucoma',
    severity: 'contraindicated',
    description: 'Siklopentolat pupil dilate ederek dar açılı glokom krizini tetikler.',
  },
  {
    drugA: 'tropicamide',
    drugB: 'narrow angle glaucoma',
    severity: 'contraindicated',
    description: 'Tropikamid dar açılı glokomda akut atak riski yaratır.',
  },
  {
    drugA: 'phenylephrine',
    drugB: 'narrow angle glaucoma',
    severity: 'severe',
    description: 'Fenilefrin sempatomimetik; pupil dilatasyonu + akut atak riski.',
  },
  {
    drugA: 'atropine',
    drugB: 'narrow angle glaucoma',
    severity: 'contraindicated',
    description: 'Atropin güçlü ve uzun süreli mydriasis; glokomda yasak.',
  },
  // --- Antibiyotik proflaksisi + intraoperatif alerji ---
  {
    drugA: 'moxifloxacin',
    drugB: 'penicillin allergy',
    severity: 'mild',
    description: 'Florokinolon farklı sınıf; penisilin allerjisi olanlarda güvenli.',
  },
  {
    drugA: 'vancomycin',
    drugB: 'red man syndrome',
    severity: 'moderate',
    description: 'Hızlı IV infüzyon kızarıklık tetikler; 60 dakikada infüze et.',
  },
  // --- Ağrı kesici + antikoagülan ---
  {
    drugA: 'ibuprofen',
    drugB: 'warfarin',
    severity: 'severe',
    description: 'NSAID warfarini güçlendirir; INR yükselir, kanama riski artar.',
  },
  {
    drugA: 'diclofenac',
    drugB: 'warfarin',
    severity: 'severe',
    description: 'Topik diklofenak sistemik geçişi düşük; ama uzun süre kullanım risk.',
  },
  {
    drugA: 'paracetamol',
    drugB: 'warfarin',
    severity: 'moderate',
    description: 'Düzenli yüksek doz parasetamol INR yükseltir; 7+ gün kullanımda monitör.',
  },
  // --- IOP düşürücüler + diğerleri ---
  {
    drugA: 'brimonidine',
    drugB: 'mao inhibitor',
    severity: 'contraindicated',
    description: 'Brimonidin alfa-agonist; MAO inhibitörü ile hipertansif kriz riski.',
  },
  {
    drugA: 'pilocarpine',
    drugB: 'retinal detachment history',
    severity: 'severe',
    description: 'Pilokarpin akomodatif spazm + retina dekolman riski geçmişi olanlarda.',
  },
  {
    drugA: 'acetazolamide',
    drugB: 'sulfa allergy',
    severity: 'severe',
    description: 'Asetazolamid sulfonamid yapısında; sulfa allerjisinde reaksiyon riski.',
  },
  // --- Anestezi + intraoperatif ---
  {
    drugA: 'lidocaine',
    drugB: 'amide allergy',
    severity: 'contraindicated',
    description: 'Lidokain amid grubu; gerçek amid allerjisinde alternatif gerekli.',
  },
  {
    drugA: 'midazolam',
    drugB: 'sleep apnea',
    severity: 'severe',
    description: 'Sedatif uyku apnesinde solunum baskılaması; düşük doz + monitör.',
  },
  // --- Diyabet ilaçları + cerrahi ---
  {
    drugA: 'metformin',
    drugB: 'iodinated contrast',
    severity: 'severe',
    description: 'Kontrast lakat asidoz riski; cerrahi öncesi 48h kes.',
  },
  // --- Anti-VEGF + sistemik ---
  {
    drugA: 'bevacizumab',
    drugB: 'recent stroke',
    severity: 'severe',
    description: 'Intravitreal anti-VEGF düşük sistemik geçiş; yine de 3 ay sonra başla.',
  },
  // --- Topical NSAID + cornea ---
  {
    drugA: 'ketorolac',
    drugB: 'corneal melt',
    severity: 'severe',
    description: 'Topik NSAID uzun süre + diyabet/kuru göz → kornea erimesi riski.',
  },
  {
    drugA: 'nepafenac',
    drugB: 'corneal melt',
    severity: 'moderate',
    description: 'Nepafenak güvenli profil; yine 4 haftayı aşma.',
  },
  // --- Sistemik steroid + diğer ---
  {
    drugA: 'prednisone',
    drugB: 'diabetes',
    severity: 'moderate',
    description: 'Sistemik steroid kan şekerini yükseltir; diyabette insülin ayarı.',
  },
  {
    drugA: 'prednisone',
    drugB: 'peptic ulcer',
    severity: 'severe',
    description: 'Sistemik steroid + ülser geçmişi GI kanama riski; PPI önlem.',
  },
  // --- Topical Latanoprost ---
  {
    drugA: 'latanoprost',
    drugB: 'herpetic keratitis',
    severity: 'severe',
    description: 'Prostaglandin analoğu herpes simpleks reaktivasyonu yapabilir.',
  },
  // --- Mast hücre stabilizatörleri ---
  {
    drugA: 'cromolyn',
    drugB: 'contact lens',
    severity: 'mild',
    description: 'Kontak lensli hastalarda 15 dakika çıkarık beklesin.',
  },
  // --- Sistemik anti-VEGF / Avastin ---
  {
    drugA: 'avastin',
    drugB: 'hypertension uncontrolled',
    severity: 'severe',
    description: 'Avastin (bevacizumab) hipertansiyonu artırır; >160/100 olunca ertele.',
  },
  // --- Tüm steroid + viral keratit ---
  {
    drugA: 'dexamethasone',
    drugB: 'herpetic keratitis',
    severity: 'contraindicated',
    description:
      'Steroid herpes simpleks keratitini agresif aktive eder; antiviral koplay zorunlu.',
  },
  {
    drugA: 'prednisolone',
    drugB: 'herpetic keratitis',
    severity: 'contraindicated',
    description: 'Steroid herpes simpleks keratitini agresif aktive eder.',
  },
  // --- Diabetic retinopati ---
  {
    drugA: 'metformin',
    drugB: 'pdr severe',
    severity: 'mild',
    description: 'PDR şiddetinde laser tedavisi sonrası hipoglisemi monitörü.',
  },
  // --- Common eyedrop allergens ---
  {
    drugA: 'thimerosal',
    drugB: 'preservative allergy',
    severity: 'severe',
    description: 'Tiomersal koruyucu allerjik konjonktivit yapabilir; tek doz alternatif.',
  },
  {
    drugA: 'benzalkonium',
    drugB: 'preservative allergy',
    severity: 'moderate',
    description: 'BAK toksik yüzey hücre etkisi + allerji; preservative-free öner.',
  },
  // --- Florokinolon sistemik + aort ---
  {
    drugA: 'ciprofloxacin',
    drugB: 'aortic aneurysm',
    severity: 'severe',
    description: 'Sistemik kinolon aort disseksiyon riski; >60 yaş + AAA dikkat.',
  },
  // --- Pre-op fasting + diabetes ---
  {
    drugA: 'insulin',
    drugB: 'fasting before surgery',
    severity: 'severe',
    description: 'Ameliyat sabahı insülin yarı doz; hipoglisemi monitörü.',
  },
  // --- Common steroid + cataract ---
  {
    drugA: 'inhaled steroid',
    drugB: 'cataract',
    severity: 'mild',
    description: 'Uzun süreli inhale steroid posterior subkapsüler katarakt riski.',
  },
];
