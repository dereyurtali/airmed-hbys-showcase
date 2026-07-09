-- v0.4 (#538, İP-2) — 3 yeni rolü mevcut tenant'lara seed + "mod" göçü.
--
-- Hedef: hiçbir kullanıcı elle taşınmadan eski "ölçüm hemşiresi" kullanıcıları
-- yeni standarda ("hemşire + olcum modu") geçsin; mevcut hemşireler de default
-- modları alsın. Tümü idempotent (yeniden çalıştırılabilir) ve veri-kaybısız.
-- olcum_hemsiresi enum değeri + rol satırları KORUNUR (çift-yol; #537 plan §3.3).
--
-- GERİ ALMA NOTU: bu migration veri ekler/günceller (DDL yok). Geri almak için
-- flags.modes alanı kaldırılır ve adım 4'te eklenen hemşire user_roles satırları
-- silinir; pratikte gerek yok (additive, geri-uyumlu).

-- 1) Yeni 3 rolü her tenant'a seed (idempotent). is_active=true (seed-helpers ile
--    aynı varsayılan; yönetici kullanmadığını sonra pasifleştirebilir).
INSERT INTO roles (id, tenant_id, key, label, is_active, created_at)
SELECT gen_random_uuid(), t.id, v.key::"RoleKey", v.label, true, NOW()
FROM tenants t
CROSS JOIN (VALUES
  ('finans', 'Finans Yetkilisi'),
  ('stok_satinalma', 'Stok & Satın Alma'),
  ('eczane', 'Eczane Personeli')
) AS v(key, label)
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.tenant_id = t.id AND r.key = v.key::"RoleKey"
);

-- 2) MOD GÖÇÜ — flags.modes'u ORİJİNAL rol kümesine göre belirle. Sıra önemli:
--    önce olcum (en spesifik), sonra generic hemşire; her adımda `? 'modes'`
--    guard'ı sayesinde kullanıcı yalnız bir kez işlenir (mutually exclusive +
--    idempotent). Hemşire rolü EKLEME (adım 4) en sona kalır ki snapshot bozulmasın.

-- 2a) Yalnız-olcum_hemsiresi kullanıcılar → ['olcum'] (kilitli kiosk korunur).
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

-- 2c) Mod almamış HEMŞİRE kullanıcılar → ['genel','asistan'].
UPDATE users u
SET flags = COALESCE(u.flags, '{}'::jsonb) || jsonb_build_object('modes', '["genel","asistan"]'::jsonb)
WHERE EXISTS (
  SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id AND r.key = 'hemsire'::"RoleKey"
)
AND NOT (COALESCE(u.flags, '{}'::jsonb) ? 'modes');

-- 3) olcum_hemsiresi taşıyan her kullanıcıya HEMŞİRE rolü ekle (yeni standart:
--    "hemsire + olcum modu"). olcum_hemsiresi rol satırı korunur (çift-yol).
--    user_roles sync_outbox trigger'ı bu INSERT'lerde tetiklenir (beklenen).
INSERT INTO user_roles (id, tenant_id, user_id, role_id, assigned_at)
SELECT gen_random_uuid(), ur.tenant_id, ur.user_id, hr.id, NOW()
FROM user_roles ur
JOIN roles olr ON olr.id = ur.role_id AND olr.key = 'olcum_hemsiresi'::"RoleKey"
JOIN roles hr ON hr.tenant_id = ur.tenant_id AND hr.key = 'hemsire'::"RoleKey"
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles ur2 WHERE ur2.user_id = ur.user_id AND ur2.role_id = hr.id
);
