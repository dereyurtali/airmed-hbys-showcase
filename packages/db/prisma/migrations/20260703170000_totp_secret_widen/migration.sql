-- #914 — TOTP secret'ları AES-256-GCM şifreli tutulur (uygulama katmanı).
-- Şifreli değer (v1.gcm.<iv>.<tag>.<ciphertext>, base64) VarChar(64)'ü aşar →
-- kolon 255'e genişletilir. Mevcut düz-metin sırlar korunur (self-healing:
-- platform-auth.service ilk başarılı TOTP doğrulamasında şifreler).
ALTER TABLE "platform_admins" ALTER COLUMN "totp_secret" TYPE VARCHAR(255);
