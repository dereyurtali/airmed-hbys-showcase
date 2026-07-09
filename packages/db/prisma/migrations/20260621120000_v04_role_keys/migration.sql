-- v0.4 (#538, İP-2) — RoleKey enum'a 3 yeni klinik rol değeri.
-- Finans Yetkilisi, Stok & Satın Alma, Eczane Personeli.
--
-- Kanonik desen (s12a/s16): enum ADD VALUE ayrı migration, değeri KULLANAN
-- seed/veri göçü ayrı migration (20260621120100). Aynı transaction içinde yeni
-- enum değerini kullanmak Postgres'te "unsafe use of new value" hatası verir;
-- ayrı migration ile değer commit edildikten sonra kullanılır.
ALTER TYPE "RoleKey" ADD VALUE IF NOT EXISTS 'finans';
ALTER TYPE "RoleKey" ADD VALUE IF NOT EXISTS 'stok_satinalma';
ALTER TYPE "RoleKey" ADD VALUE IF NOT EXISTS 'eczane';
