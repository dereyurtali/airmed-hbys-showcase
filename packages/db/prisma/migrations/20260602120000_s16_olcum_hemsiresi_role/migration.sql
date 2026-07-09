-- S16 — RoleKey enum'una `olcum_hemsiresi` değeri (ölçüm odası istasyon rolü).
--
-- NOTE: Postgres "ALTER TYPE ... ADD VALUE" aynı transaction'da kullanılamaz.
-- INSERT bir sonraki migration'da: 20260602120001_s16_seed_olcum_hemsiresi_role

ALTER TYPE "RoleKey" ADD VALUE IF NOT EXISTS 'olcum_hemsiresi';
