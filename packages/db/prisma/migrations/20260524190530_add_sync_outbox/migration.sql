-- A12 — Hibrit sync outbox tablosu + PG trigger function + per-entity trigger'lar.
--
-- Atomik garanti: trigger AFTER fired, aynı transaction içinde sync_outbox'a
-- yazıyor. App crash → trigger rollback → outbox satırı yok. Tam tersi de:
-- entity başarıyla yazıldıysa outbox satırı da var.
--
-- Source: PG session variable `app.sync_source` (LOCAL veya CLOUD). App boot'unda
-- TenantInterceptor benzeri bir hook her connection'a `SET LOCAL` yapacak. Set
-- edilmemişse default 'LOCAL' (tek-node pilot için emniyetli varsayım).

CREATE TABLE "sync_outbox" (
    "id" UUID NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "operation" VARCHAR(10) NOT NULL,
    "tenant_id" UUID,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "failed_at" TIMESTAMP(3),
    CONSTRAINT "sync_outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sync_outbox_synced_at_created_at_idx" ON "sync_outbox"("synced_at", "created_at");
CREATE INDEX "sync_outbox_entity_type_entity_id_occurred_at_idx" ON "sync_outbox"("entity_type", "entity_id", "occurred_at");
CREATE INDEX "sync_outbox_tenant_id_synced_at_idx" ON "sync_outbox"("tenant_id", "synced_at");
CREATE INDEX "sync_outbox_failed_at_idx" ON "sync_outbox"("failed_at");

-- Trigger function: TG_ARGV[0] entity_type ismi. TG_OP {INSERT,UPDATE,DELETE}.
-- to_jsonb(NEW/OLD) tüm column'ları payload'a serialize eder (datetime,
-- jsonb iç içe, uuid, enum hepsi otomatik).
CREATE OR REPLACE FUNCTION sync_outbox_record() RETURNS TRIGGER AS $$
DECLARE
  v_source text := COALESCE(current_setting('app.sync_source', true), 'LOCAL');
  v_entity_type text := TG_ARGV[0];
  v_entity_id uuid;
  v_operation text := TG_OP;
  v_tenant_id uuid;
  v_payload jsonb;
  v_occurred_at timestamp;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_entity_id := OLD.id;
    v_tenant_id := OLD.tenant_id;
    v_payload := to_jsonb(OLD);
    -- Soft-delete: deleted_at varsa onu kullan, yoksa şu an
    v_occurred_at := COALESCE((to_jsonb(OLD)->>'deleted_at')::timestamp, NOW());
  ELSE
    v_entity_id := NEW.id;
    v_tenant_id := NEW.tenant_id;
    v_payload := to_jsonb(NEW);
    v_occurred_at := COALESCE(
      (to_jsonb(NEW)->>'updated_at')::timestamp,
      (to_jsonb(NEW)->>'created_at')::timestamp,
      NOW()
    );
  END IF;

  INSERT INTO sync_outbox (
    id, source, entity_type, entity_id, operation, tenant_id, payload, occurred_at
  ) VALUES (
    gen_random_uuid(), v_source, v_entity_type, v_entity_id,
    v_operation, v_tenant_id, v_payload, v_occurred_at
  );

  RETURN NULL; -- AFTER trigger, dönüş değeri yok sayılır
END;
$$ LANGUAGE plpgsql;

-- Per-entity trigger'lar. v0.2 pilot whitelist — klinik akışın kalbi:
-- demografi, randevu, muayene, ölçüm, cerrahi, sarf, ilaç, foto metadata,
-- kullanıcı/rol/doktor yönetimi.
--
-- KAPSAM DIŞI (sync edilmez):
-- - sync_outbox (sonsuz döngü engeli)
-- - audit_logs (kendi stream'i, retention farklı)
-- - refresh_tokens (lokal auth state)
-- - tenant_impersonations (cross-tenant tracking, platform tarafı)
-- - tenants, platform_* (platform katmanı, sync edilmez)
-- - fraud_alerts (LOCAL detector ürettiği için karşı node ayrı detect eder)

CREATE TRIGGER patients_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON patients
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('patient');

CREATE TRIGGER appointments_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('appointment');

CREATE TRIGGER examinations_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON examinations
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('examination');

CREATE TRIGGER surgeries_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON surgeries
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('surgery');

CREATE TRIGGER measurements_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON measurements
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('measurement');

CREATE TRIGGER pre_ops_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON pre_ops
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('preOp');

CREATE TRIGGER procedures_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON procedures
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('procedure');

CREATE TRIGGER lab_tests_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON lab_tests
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('labTest');

CREATE TRIGGER prescriptions_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('prescription');

CREATE TRIGGER iol_models_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON iol_models
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('iolModel');

CREATE TRIGGER iol_lots_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON iol_lots
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('iolLot');

CREATE TRIGGER iol_stock_movements_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON iol_stock_movements
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('iolStockMovement');

CREATE TRIGGER patient_photos_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON patient_photos
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('patientPhoto');

CREATE TRIGGER consent_signings_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON consent_signings
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('consentSigning');

CREATE TRIGGER consent_templates_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON consent_templates
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('consentTemplate');

CREATE TRIGGER doctors_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON doctors
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('doctor');

CREATE TRIGGER doctor_availabilities_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON doctor_availabilities
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('doctorAvailability');

CREATE TRIGGER doctor_leaves_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON doctor_leaves
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('doctorLeave');

CREATE TRIGGER users_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('user');

CREATE TRIGGER user_roles_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('userRole');

CREATE TRIGGER roles_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('role');

CREATE TRIGGER commission_rules_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON commission_rules
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('commissionRule');

CREATE TRIGGER commission_entries_sync_outbox
  AFTER INSERT OR UPDATE OR DELETE ON commission_entries
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('commissionEntry');

-- user_roles ve roles tablolarında `id` column'u var mı? user_roles composite
-- key kullanıyor (tenant_id, user_id, role_id). Bunu trigger function'a
-- uyarlamak gerekirse ayrı record_sync_event_composite() fonksiyonu.
-- Pilot için: composite key tablolarına trigger eklemiyoruz, app katmanı
-- userRoles değişikliklerini parent user UPDATE event'i ile birlikte alır.
-- Yukarıdaki user_roles trigger'ı çalışmaz çünkü function NEW.id arıyor;
-- DROP edip alternatif yaklaşımı PR 2'de uygulayalım.

DROP TRIGGER IF EXISTS user_roles_sync_outbox ON user_roles;
