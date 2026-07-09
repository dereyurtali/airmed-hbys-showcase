-- R5 (#727) — Yönetici Asistanı indirim onayını yöneticiye eskale eder
-- ("Eskale et" → "Yöneticiye ilet"). Eskale, action:approval.review yetkili
-- yöneticilere (yonetici + finans) bir bildirim üretir. Mevcut Notification
-- altyapısı kullanılır; yeni tek enum değeri.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'approval_escalated';
