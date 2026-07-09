-- A12 PR 3 — sync_conflicts queue.
-- Receive endpoint LWW / unique_create / delete_update conflict tipinde
-- satırı buraya yazıp event'i skip eder. Admin UI listeleyip manuel
-- resolve eder.

CREATE TABLE "sync_conflicts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "tenant_id" UUID,
    "conflict_type" VARCHAR(30) NOT NULL,
    "remote_source" VARCHAR(10) NOT NULL,
    "local_snapshot" JSONB,
    "remote_snapshot" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "resolution" VARCHAR(20),
    CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sync_conflicts_resolved_at_created_at_idx" ON "sync_conflicts"("resolved_at", "created_at");
CREATE INDEX "sync_conflicts_tenant_id_resolved_at_idx" ON "sync_conflicts"("tenant_id", "resolved_at");
CREATE INDEX "sync_conflicts_entity_type_entity_id_idx" ON "sync_conflicts"("entity_type", "entity_id");
