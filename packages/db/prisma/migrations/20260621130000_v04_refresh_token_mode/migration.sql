-- v0.4 (#539, İP-3) — refresh_tokens'a oturum çalışma modu kolonu.
-- Login'de seçilen mod refresh token satırına yazılır; refresh rotasyonunda
-- yeni satıra taşınır. Böylece kilitli kiosk (örn. olcum) access token süresi
-- (15dk) dolup refresh ile yenilenince de kilitli kalır; çok-modlu kullanıcı
-- seçtiği moda sabit kalır. NULL = mod kavramı olmayan oturum (klasik).
ALTER TABLE "refresh_tokens" ADD COLUMN "mode" VARCHAR(32);
