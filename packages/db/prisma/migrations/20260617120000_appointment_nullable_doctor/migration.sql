-- #367 — Doktorsuz "genel randevu" (havuz). doctor_id nullable; null randevu
-- check-in'de / sonradan müsait doktora atanır. EXCLUDE GIST null doctor'da
-- çakışma kontrolü yapmaz (havuz randevuları atamada netleşir).
ALTER TABLE "appointments" ALTER COLUMN "doctor_id" DROP NOT NULL;
