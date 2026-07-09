-- S12a (devam) — Mevcut tenant'lara `ameliyat_satis` rol satırı seed.
-- Yeni tenant'lar packages/db/prisma/seed.ts üzerinden alır.
-- Klinik aktive ederek kullanıcı atar; pasif başlangıç klinik tercihi
-- (default isActive=true seed'le uyumlu, ama mevcut tenant'lar için
-- pasif başlangıç tercih ediliyor — yöneticinin aktif etmesi gerekir).

INSERT INTO roles (id, tenant_id, key, label, is_active, created_at)
SELECT
  gen_random_uuid(),
  t.id,
  'ameliyat_satis'::"RoleKey",
  'Ameliyat Satış',
  true,
  NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM roles r
  WHERE r.tenant_id = t.id AND r.key = 'ameliyat_satis'::"RoleKey"
);
