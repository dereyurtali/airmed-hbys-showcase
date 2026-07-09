-- S17 — hemsire + olcum_hemsiresi rolleri default aktif.
-- Mevcut tenant'lardaki pasif satırları aktive et; yeni tenant'lar
-- packages/db/src/seed-helpers.ts DEFAULT_CLINIC_ROLES'tan aktif gelir.
--
-- Bağlam: AdminUsersPage "Yeni Kullanıcı" formunda yönetici hemşire veya ölçüm
-- hemşiresi seçtiğinde UsersService.create "rol pasif" diye 400 atıyordu. UI
-- dropdown'da bu roller var ama backend reddediyor → tutarsız UX. CLAUDE.md
-- kanonik tablosu "Toplam aktif klinik rol = 7" diyor; default'u oraya hizaladık.
-- Yönetici opsiyonel olarak ileride pasifleştirebilir (Ayarlar UI ileri faz).

UPDATE roles
SET is_active = true, updated_at = NOW()
WHERE key IN ('hemsire'::"RoleKey", 'olcum_hemsiresi'::"RoleKey")
  AND is_active = false;
