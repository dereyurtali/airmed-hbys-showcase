-- #1085 — Platform zaman-serisi metrik snapshot'ı (RLS-dışı platform tablosu;
-- platform_audit_logs gibi cross-tenant, tenant_id yok). 5 dk örnekleme + 14g
-- retention. İzleme ekranlarının trend/kapasite temeli.

CREATE TABLE "platform_metrics_snapshots" (
    "id" UUID NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "db_size_bytes" BIGINT NOT NULL,
    "db_conn_active" INTEGER NOT NULL,
    "db_conn_idle" INTEGER NOT NULL,
    "db_conn_idle_in_tx" INTEGER NOT NULL,
    "db_conn_total" INTEGER NOT NULL,
    "slow_query_count" INTEGER,
    "node_heap_used_bytes" BIGINT NOT NULL,
    "node_rss_bytes" BIGINT NOT NULL,
    "node_event_loop_lag_ms" DOUBLE PRECISION NOT NULL,
    "host_cpu_pct" DOUBLE PRECISION NOT NULL,
    "host_mem_used_bytes" BIGINT NOT NULL,
    "host_mem_total_bytes" BIGINT NOT NULL,
    "host_disk_used_bytes" BIGINT NOT NULL,
    "host_disk_total_bytes" BIGINT NOT NULL,
    "tenant_counts" JSONB NOT NULL,
    "active_users" INTEGER NOT NULL,
    "active_sessions" INTEGER NOT NULL,
    CONSTRAINT "platform_metrics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_metrics_snapshots_captured_at_idx" ON "platform_metrics_snapshots"("captured_at");

-- Platform tablosu RLS'siz (tenant_id yok, yalnız platform-admin auth'lu
-- kod erişir). airmed_app GRANT — rol yoksa atla (fresh DB / CI guard).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON "platform_metrics_snapshots" TO airmed_app';
  END IF;
END$$;
