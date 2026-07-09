-- S15-PR7 — Pediatrik veli onam alanları + pediatrik şablonlar seed.
-- ConsentSigning'e 4 yeni field: signedByGuardian, guardianName, guardianRelationship,
-- guardianIdentityNo. Service-layer guard hasta yaş <18 ise veli imzası zorunlu.

ALTER TABLE "consent_signings"
  ADD COLUMN "signed_by_guardian" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "guardian_name" VARCHAR(200),
  ADD COLUMN "guardian_relationship" "GuardianRelationship",
  ADD COLUMN "guardian_identity_no" VARCHAR(50);

-- Pediatrik onam raporu için index (veli imzalı kayıtların sayısı).
CREATE INDEX "consent_signings_guardian_idx"
  ON "consent_signings" (tenant_id, signed_at)
  WHERE signed_by_guardian = true;
