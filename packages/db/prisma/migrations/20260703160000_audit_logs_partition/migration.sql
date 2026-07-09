-- #957 — audit_logs'u aylık range partition'a (created_at) çevir + drop-based
-- retention. CLAUDE.md Auth Kanonik Tablosu "180 gün (partition)" der ama tablo
-- düz + retention DELETE'liydi (audit-cleanup.service). Go-live sonrası hasta
-- trafiğiyle audit sınırsız büyür; partition-drop DELETE'in disk/WAL maliyetinden
-- kaçınır (kendi runbook ilkesi).
--
-- Range partition, partition key'i (created_at) PK'ya zorunlu kılar → PK
-- (id) yerine (id, created_at). schema.prisma AuditLog @@id([id, createdAt]);
-- audit-cosign.service .update'leri composite locator'a geçirildi.

-- ---------------------------------------------------------------------------
-- 1) Partition yönetim fonksiyonları (idempotent). Retention cron'u kullanır.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_audit_log_partition(p_month date) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := 'audit_logs_p' || to_char(v_start, 'YYYYMM');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = v_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
      v_name, v_start, v_end
    );
  END IF;
END;
$fn$;

-- 180 günden (verilen retention) tamamen eski aylık partition'ları DROP eder.
-- DEFAULT partition ve retention içindeki partition'lara dokunmaz. Silinen
-- partition sayısını döndürür.
CREATE OR REPLACE FUNCTION drop_old_audit_partitions(p_retention_days int) RETURNS int
LANGUAGE plpgsql AS $fn$
DECLARE
  v_cutoff date := (now() - make_interval(days => GREATEST(p_retention_days, 30)))::date;
  v_rec record;
  v_dropped int := 0;
BEGIN
  FOR v_rec IN
    SELECT c.relname,
           (regexp_replace(pg_get_expr(c.relpartbound, c.oid), '.*TO \(''([0-9-]+).*', '\1'))::date AS upper_bound
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'audit_logs'
      AND pg_get_expr(c.relpartbound, c.oid) LIKE 'FOR VALUES FROM%'
  LOOP
    IF v_rec.upper_bound <= v_cutoff THEN
      EXECUTE format('DROP TABLE %I', v_rec.relname);
      v_dropped := v_dropped + 1;
    END IF;
  END LOOP;
  RETURN v_dropped;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2) Yeni partition'lı tablo (composite PK: partition key dahil).
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs_new (LIKE audit_logs INCLUDING DEFAULTS) PARTITION BY RANGE (created_at);
ALTER TABLE audit_logs_new ADD CONSTRAINT audit_logs_new_pkey PRIMARY KEY (id, created_at);

-- RLS (mevcut policy aynen).
ALTER TABLE audit_logs_new ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs_new FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs_new
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Indexler (geçici isim; swap sonrası kanonik Prisma isimlerine rename edilir).
CREATE INDEX audit_logs_new_i1 ON audit_logs_new (tenant_id, created_at);
CREATE INDEX audit_logs_new_i2 ON audit_logs_new (tenant_id, user_id, created_at);
CREATE INDEX audit_logs_new_i3 ON audit_logs_new (tenant_id, entity_type, entity_id);
CREATE INDEX audit_logs_new_i4 ON audit_logs_new (tenant_id, on_behalf_of_user_id, created_at);
CREATE INDEX audit_logs_new_i5 ON audit_logs_new (tenant_id, on_behalf_of_user_id, cosigned_at);

-- FKler (constraint isimleri per-table → eski tabloyla çakışmaz, kanonik verilir).
ALTER TABLE audit_logs_new ADD CONSTRAINT audit_logs_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE audit_logs_new ADD CONSTRAINT audit_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE audit_logs_new ADD CONSTRAINT audit_logs_on_behalf_of_fkey
  FOREIGN KEY (on_behalf_of_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE audit_logs_new ADD CONSTRAINT audit_logs_nurse_session_fkey
  FOREIGN KEY (nurse_session_id) REFERENCES nurse_assistance_sessions(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE audit_logs_new ADD CONSTRAINT audit_logs_cosigned_by_id_fkey
  FOREIGN KEY (cosigned_by_id) REFERENCES users(id);

-- DEFAULT partition (emniyet ağı: cron aylık partition yaratmayı kaçırsa bile
-- write asla 'no partition' ile düşmez). Normalde boş kalır; retention dokunmaz.
CREATE TABLE audit_logs_default PARTITION OF audit_logs_new DEFAULT;

-- ---------------------------------------------------------------------------
-- 3) Mevcut veriyi kapsayan partition'lar + gelecek 3 ay tamponu.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  m date;
  min_m date;
  max_m date;
BEGIN
  SELECT date_trunc('month', min(created_at))::date, date_trunc('month', max(created_at))::date
    INTO min_m, max_m FROM audit_logs;
  IF min_m IS NULL THEN min_m := date_trunc('month', now())::date; END IF;
  max_m := GREATEST(COALESCE(max_m, min_m), date_trunc('month', now())::date)
           + interval '3 months';
  m := min_m;
  WHILE m < max_m LOOP
    EXECUTE format('CREATE TABLE %I PARTITION OF audit_logs_new FOR VALUES FROM (%L) TO (%L)',
      'audit_logs_p' || to_char(m, 'YYYYMM'), m, (m + interval '1 month')::date);
    m := (m + interval '1 month')::date;
  END LOOP;
END;
$do$;

-- ---------------------------------------------------------------------------
-- 4) Veri kopyala + swap + kanonik isimlere rename.
-- ---------------------------------------------------------------------------
INSERT INTO audit_logs_new SELECT * FROM audit_logs;

DROP TABLE audit_logs;
ALTER TABLE audit_logs_new RENAME TO audit_logs;
ALTER TABLE audit_logs RENAME CONSTRAINT audit_logs_new_pkey TO audit_logs_pkey;
ALTER INDEX audit_logs_new_i1 RENAME TO audit_logs_tenant_id_created_at_idx;
ALTER INDEX audit_logs_new_i2 RENAME TO audit_logs_tenant_id_user_id_created_at_idx;
ALTER INDEX audit_logs_new_i3 RENAME TO audit_logs_tenant_id_entity_type_entity_id_idx;
ALTER INDEX audit_logs_new_i4 RENAME TO audit_logs_on_behalf_of_idx;
ALTER INDEX audit_logs_new_i5 RENAME TO audit_logs_tenant_pending_cosign_idx;
