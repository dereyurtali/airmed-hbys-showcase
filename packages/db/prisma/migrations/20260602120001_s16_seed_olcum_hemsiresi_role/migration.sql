-- S16 (devam) — Mevcut tenant'lara `olcum_hemsiresi` rol satırı seed.
-- Yeni tenant'lar packages/db/prisma/seed.ts üzerinden alır.
-- Opsiyonel istasyon rolü: pasif başlangıç (is_active=false); yöneticinin
-- aktive edip kullanıcı ataması gerekir (hemsire deseni). Demo seed aktive eder.

INSERT INTO roles (id, tenant_id, key, label, is_active, created_at)
SELECT
  gen_random_uuid(),
  t.id,
  'olcum_hemsiresi'::"RoleKey",
  'Ölçüm Hemşiresi',
  false,
  NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM roles r
  WHERE r.tenant_id = t.id AND r.key = 'olcum_hemsiresi'::"RoleKey"
);
