-- #677 takip — hemşire/ölçüm MOD re-backfill (idempotent).
-- Sorun: orijinal mod göçü (20260621120100_v04_seed_roles_and_olcum_modes) tek
-- seferlikti. O tarihten SONRA, mod-default ATAMAYAN eski create-form ile oluşturulan
-- hemşire/ölçüm kullanıcıları flags.modes'suz kaldı → login mod seçici çıkmıyordu.
-- create artık default atıyor (users.service v0.4 fix); bu migration eski boşluğu
-- kapatır (modes'u OLMAYAN kullanıcılar). DDL yok, additive + veri-kaybısız.

-- 2a) Yalnız-olcum_hemsiresi → ['olcum'] (kilitli kiosk).
UPDATE users u
SET flags = COALESCE(u.flags, '{}'::jsonb) || jsonb_build_object('modes', '["olcum"]'::jsonb)
WHERE EXISTS (
  SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id AND r.key = 'olcum_hemsiresi'::"RoleKey"
)
AND NOT EXISTS (
  SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id AND r.key <> 'olcum_hemsiresi'::"RoleKey"
)
AND NOT (COALESCE(u.flags, '{}'::jsonb) ? 'modes');

-- 2b) olcum_hemsiresi + başka rol → ['genel','asistan','olcum'].
UPDATE users u
SET flags = COALESCE(u.flags, '{}'::jsonb) || jsonb_build_object('modes', '["genel","asistan","olcum"]'::jsonb)
WHERE EXISTS (
  SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id AND r.key = 'olcum_hemsiresi'::"RoleKey"
)
AND NOT (COALESCE(u.flags, '{}'::jsonb) ? 'modes');

-- 2c) Mod almamış HEMŞİRE → ['genel','asistan'].
UPDATE users u
SET flags = COALESCE(u.flags, '{}'::jsonb) || jsonb_build_object('modes', '["genel","asistan"]'::jsonb)
WHERE EXISTS (
  SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id AND r.key = 'hemsire'::"RoleKey"
)
AND NOT (COALESCE(u.flags, '{}'::jsonb) ? 'modes');
