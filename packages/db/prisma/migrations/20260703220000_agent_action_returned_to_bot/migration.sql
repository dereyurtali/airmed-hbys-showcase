-- #1038 — Personel konuşmayı HBYS ekranından bota geri verdiğinde denetim
-- kaydı için yeni aksiyon tipi.
ALTER TYPE "AgentActionType" ADD VALUE 'returned_to_bot';
