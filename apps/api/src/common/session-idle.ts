// #921 — 30 dk inaktivite (idle) oturum timeout'u (klinik + platform ortak).
//
// Refresh rotasyonu her aktivitede refresh token satırının createdAt'ini tazeler.
// Frontend reactive refresh eder (401 → /auth/refresh → retry); kullanıcı idle iken
// istek yok → refresh yok → mevcut token'ın createdAt'i sabit kalır. Bir refresh
// isteği geldiğinde token createdAt idle eşiğinden eskiyse oturum idle-expired
// sayılır (revoke + reddet). Çalınmış bir refresh token da 30 dk kullanılmazsa ölür.
//
// Env override (dk): SESSION_IDLE_TIMEOUT_MINUTES (varsayılan 30).
export const SESSION_IDLE_TIMEOUT_MS =
  (Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES) || 30) * 60 * 1000;
