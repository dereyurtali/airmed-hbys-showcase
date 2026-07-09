-- #935 — Examination soft-delete index. Diğer soft-delete tablolarında
-- @@index([tenantId, deletedAt]) var; examinations'ta eksikti → deletedAt IS NULL
-- filtreli listeler (aktif muayeneler) tenant-içi tam tarama yapıyordu.
-- İsim Prisma default'u (examinations_tenant_id_deleted_at_idx) = schema.prisma
-- @@index([tenantId, deletedAt]) ile birebir → drift yok (map: gerekmez).
CREATE INDEX "examinations_tenant_id_deleted_at_idx" ON "examinations"("tenant_id", "deleted_at");
