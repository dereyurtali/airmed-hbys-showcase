-- S5 — User.flags JSONB kolonu (karar tutanağı §3 rol üstü bayraklar).
--
-- Pilot şu an iki flag tanımlı (her ikisi de doktor user'a takılır):
--   - is_visiting_doctor: bool — misafir cerrah, sadece kendi cerrahileri görür
--   - can_see_all_patients: bool — yönetici override (baş hekim için)
--
-- JSON tipi şema değişikliği gerektirmeden yeni flag eklemeye izin verir.
-- Mevcut user satırları NULL kalır (default flag yok); JWT claim'de undefined,
-- davranış değişikliği yok (geriye uyumlu).

ALTER TABLE "users" ADD COLUMN "flags" JSONB;
