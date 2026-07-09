-- S15-PR1 — Patient model expansion: tıbbi alanlar + pediatrik veli.
-- Pilot blocker hukuki güvenlik gereği (hasta foto kayıt, allerji/antikoagülan
-- uyarısı, kan grubu, pediatrik veli ilişkisi). Geriye dönük uyumlu (tüm yeni
-- alanlar nullable veya boş array default'lu).

-- BloodType enum: ABO + Rh + unknown.
CREATE TYPE "BloodType" AS ENUM (
  'a_pos',
  'a_neg',
  'b_pos',
  'b_neg',
  'ab_pos',
  'ab_neg',
  'o_pos',
  'o_neg',
  'unknown'
);

-- GuardianRelationship enum: PR7 pediatrik onam akışında "kim imzaladı" yapısal
-- kayıt için. "other" serbest açıklama gerektirir (notes alanına yazılır).
CREATE TYPE "GuardianRelationship" AS ENUM (
  'mother',
  'father',
  'legal_guardian',
  'grandparent',
  'sibling',
  'other'
);

-- Patient.photo_url: PR2'de StorageService.uploadPatientPhoto'dan dönen URL'i
-- tutar. Şimdilik nullable; PR2 sonrası "yeni hasta kaydında foto önerilir
-- ama zorunlu değil" UX kararı uygulanır.
ALTER TABLE "patients"
  ADD COLUMN "photo_url" VARCHAR(500),
  ADD COLUMN "allergies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "anticoagulant_medications" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "blood_type" "BloodType",
  ADD COLUMN "pediatric_guardian_name" VARCHAR(200),
  ADD COLUMN "pediatric_guardian_phone" VARCHAR(20),
  ADD COLUMN "pediatric_guardian_relationship" "GuardianRelationship";

-- Allerji + antikoagülan dolu hasta sayısı operasyon raporlarında lazım olur
-- (örn. "Bu ay kaç hasta antikoagülan ilaç kullanıyor görüldü"). GIN array
-- index yerine kısmi btree index (boş olmayanlar) — array length check ucuz.
CREATE INDEX "patients_has_allergies_idx"
  ON "patients" (tenant_id)
  WHERE array_length(allergies, 1) > 0;

CREATE INDEX "patients_has_anticoagulant_idx"
  ON "patients" (tenant_id)
  WHERE array_length(anticoagulant_medications, 1) > 0;

-- Pediatrik hasta (yaş <18) listelemesi için: birth_date based ad-hoc query
-- yeterli; ayrı index gerekmez. Veli relationship dolu olanlar küçük subset.
