#!/bin/bash
# Postgres first-boot init for AirMed-HBYS (docker-entrypoint-initdb.d).
#
# #925 — airmed_app (RLS runtime rolü) parolası artık env'den gelir
# (AIRMED_APP_PASSWORD). Postgres'in .sql init dosyaları env okuyamadığı için bu
# shell wrapper parolayı psql değişkeni (:app_password) olarak geçirir —
# string interpolation yok, SQL injection'a kapalı (%L + :'..').
#
#   dev / CI      → AIRMED_APP_PASSWORD set değil → 'airmed_app_dev' (zayıf, lokal)
#   staging/prod/clinic → compose 'AIRMED_APP_PASSWORD' zorunlu (güçlü, rotate'lenebilir);
#                         API'nin DATABASE_URL_APP'i ile AYNI değer olmalı.
#
# ROTATE (çalışan prod, veri dolu → init yeniden koşmaz): süperuser ile
#   ALTER ROLE airmed_app WITH LOGIN PASSWORD '<yeni>';
# sonra AIRMED_APP_PASSWORD env'i güncelle + api container'ını restart et.
# Detay: docs/automation/clinic-appliance-runbook.md "airmed_app parola rotasyonu".
set -euo pipefail

APP_PASSWORD="${AIRMED_APP_PASSWORD:-airmed_app_dev}"
# #916 — airmed_bg: ayrıcalıklı arkaplan/cross-tenant client'ları için NOSUPERUSER
# BYPASSRLS rolü (superuser DEĞİL). Dev/CI default 'airmed_bg_dev'; prod güçlü.
BG_PASSWORD="${AIRMED_BG_PASSWORD:-airmed_bg_dev}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_password="$APP_PASSWORD" \
  --set=bg_password="$BG_PASSWORD" <<'EOSQL'
-- Postgres extensions for AirMed-HBYS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- Hasta arama (10K hasta < 2sn)
CREATE EXTENSION IF NOT EXISTS btree_gist;    -- Appointment EXCLUDE constraint için

-- #417 — Kiril/Tacik isim arama + sıralama doğruluğu DB-level locale'e BAĞLI
-- DEĞİL: patients.first_name/last_name kolonları ICU "und-x-icu" collation
-- kullanır (migration 20260616140000_s417). DB `C` locale ile başlatılsa bile
-- arama/sıralama doğru kalır (Postgres 16 imajı und-x-icu hazır getirir).

-- Runtime role for the API: cannot bypass RLS, so SET LOCAL app.current_tenant_id
-- in TenantInterceptor is the only way to see tenant data. POSTGRES_USER stays
-- superuser for migrations/seed. Parola env'den (:app_password). Koşullu create
-- (fresh volume re-init güvenli) + ALTER ile senkron.
SELECT format(
  'CREATE ROLE airmed_app WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_app')
\gexec

ALTER ROLE airmed_app WITH LOGIN PASSWORD :'app_password';

GRANT CONNECT ON DATABASE airmed_hbys TO airmed_app;
GRANT USAGE ON SCHEMA public TO airmed_app;
-- #915 — TRUNCATE bilinçli verilmez. RLS TRUNCATE'i filtrelemez; tek bir TRUNCATE
-- tüm tenant'ların verisini RLS'i bypass ederek siler. Günlük CRUD'da gerekmez.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO airmed_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO airmed_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO airmed_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO airmed_app;

-- #916 — airmed_bg: ayrıcalıklı arkaplan/cross-tenant Prisma client'ları (sync,
-- audit-cleanup, messaging, platform admin, fraud, auth-lookup, setup) için
-- NOSUPERUSER BYPASSRLS rolü. RLS'i bypass eder (cross-tenant) ama superuser
-- DEĞİL → bu servislerdeki raw-SQL injection tam DB ele geçirmeye yükselemez.
-- TRUNCATE verilmez. sync.service session_replication_role='replica' ile
-- trigger'ları kapatır; PG16 'GRANT SET ON PARAMETER' ile bu tek parametre izni
-- superuser gerektirmeden verilir.
SELECT format(
  'CREATE ROLE airmed_bg WITH LOGIN PASSWORD %L NOSUPERUSER BYPASSRLS',
  :'bg_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airmed_bg')
\gexec

ALTER ROLE airmed_bg WITH LOGIN PASSWORD :'bg_password';

GRANT CONNECT ON DATABASE airmed_hbys TO airmed_bg;
GRANT USAGE ON SCHEMA public TO airmed_bg;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO airmed_bg;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO airmed_bg;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO airmed_bg;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO airmed_bg;
GRANT SET ON PARAMETER session_replication_role TO airmed_bg;
EOSQL
