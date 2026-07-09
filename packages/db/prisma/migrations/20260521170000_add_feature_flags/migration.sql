-- F6 Feature Flags (v0.2 dilimi). Tablolar RLS dışı (platform_*-benzeri):
-- definition cross-tenant; override tenant_id ile filtrelenir ama servis admin
-- client (postgres superuser) üzerinden okur. Tenant-side query'leri ayrı bir
-- read-only endpoint üzerinden döner — RLS gerekmiyor çünkü servis tenantId'yi
-- request context'inden açıkça parametre olarak alır.

CREATE TABLE "feature_flag_definitions" (
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(2000),
    "default_value" BOOLEAN NOT NULL DEFAULT false,
    "is_global" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feature_flag_definitions_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "feature_flag_overrides" (
    "flag_key" VARCHAR(80) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "value" BOOLEAN NOT NULL,
    "set_by_id" UUID,
    "set_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feature_flag_overrides_pkey" PRIMARY KEY ("flag_key", "tenant_id")
);

CREATE INDEX "feature_flag_overrides_tenant_id_idx"
  ON "feature_flag_overrides"("tenant_id");

ALTER TABLE "feature_flag_overrides"
  ADD CONSTRAINT "feature_flag_overrides_flag_key_fkey"
  FOREIGN KEY ("flag_key") REFERENCES "feature_flag_definitions"("key")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Default flag seed (pilot için RFP modüllerini açar/kapatır)
INSERT INTO "feature_flag_definitions" (key, name, description, default_value, is_global) VALUES
  ('surgery_module', 'Cerrahi modül', 'A8/B1-B5 cerrahi pipeline', true, false),
  ('iol_inventory', 'IOL stok', 'C1 IOL stok takibi', true, false),
  ('lab_module', 'Laboratuvar', 'B2 tetkik merkezi', true, false),
  ('pharmacy_module', 'Eczane/optik', 'E3 reçete + tedarikçi', true, false),
  ('reports_advanced', 'Detaylı raporlar', 'E5 kohort + retention + heatmap', true, false),
  ('fraud_detection', 'Fraud tespiti', 'E6 4 kural-tabanlı detector + alert', false, false),
  ('commission_module', 'Doktor hakediş', 'E2 komisyon + onay workflow', true, false),
  ('consent_templates', 'Onam şablonları', 'C2 PDF şablon + dijital imza', true, false),
  ('procedure_module', 'Prosedürler', 'B5 IVT/lazer/SLT + auto follow-up', true, false),
  ('whatsapp_messaging', 'WhatsApp/SMS bildirimleri', 'D1 hasta hatırlatma (henüz aktif değil)', false, false);
