-- S15-PR19 — Bağlamsal mesajlaşma. Klinik personeli arasında hasta-bağlı
-- thread + thread mesajları. Hasta görmez; iç komünikasyon.

CREATE TABLE "patient_message_threads" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "subject" VARCHAR(200),
  "created_by_id" UUID NOT NULL,
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "patient_message_threads_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION,
  CONSTRAINT "patient_message_threads_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE NO ACTION,
  CONSTRAINT "patient_message_threads_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION
);

CREATE INDEX "patient_message_threads_tenant_patient_idx"
  ON "patient_message_threads" ("tenant_id", "patient_id", "last_message_at" DESC);

CREATE INDEX "patient_message_threads_tenant_archived_idx"
  ON "patient_message_threads" ("tenant_id", "is_archived", "last_message_at" DESC);

CREATE TABLE "patient_thread_messages" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "patient_thread_messages_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION,
  CONSTRAINT "patient_thread_messages_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "patient_message_threads"("id") ON DELETE CASCADE,
  CONSTRAINT "patient_thread_messages_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION
);

CREATE INDEX "patient_thread_messages_tenant_thread_idx"
  ON "patient_thread_messages" ("tenant_id", "thread_id", "created_at");

-- Row Level Security
ALTER TABLE "patient_message_threads" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "patient_message_threads_tenant_isolation" ON "patient_message_threads"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "patient_thread_messages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "patient_thread_messages_tenant_isolation" ON "patient_thread_messages"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
