-- #417 — Kiril (RU/TG) isim sıralaması: ICU collation (und-x-icu).
--
-- Sorun: glibc en_US.utf8 collation Tacik genişletilmiş Kiril harflerini
-- (Ғ Қ Ҳ Ҷ Ӣ Ӯ) alfabetik yerine codepoint sırasıyla EN SONA atıyor ve
-- büyük/küçük harfi ayrı bloklara bölüyor (Яков < иван). ICU "und-x-icu"
-- root collation doğru Unicode sırası verir (Ғ → Б'den sonra, иван~Иван bitişik).
--
-- Arama etkilenmez: `mode:'insensitive'` (ILIKE) + pg_trgm gin_trgm_ops
-- collation-agnostiktir; und-x-icu deterministik olduğu için LIKE/ILIKE çalışır.
-- ALTER COLUMN TYPE tabloyu ve trgm GIN index'lerini otomatik yeniden kurar.
--
-- Kolon collation'ı locale-bağımsızdır: DB `C`/`en_US`/ICU ile başlatılsa bile
-- patient isim arama/sıralaması doğru kalır (üretim init sertleştirmesi).
ALTER TABLE "patients"
  ALTER COLUMN "first_name" TYPE VARCHAR(100) COLLATE "und-x-icu",
  ALTER COLUMN "last_name"  TYPE VARCHAR(100) COLLATE "und-x-icu";
