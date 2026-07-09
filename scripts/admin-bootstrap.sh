#!/usr/bin/env bash
# admin-bootstrap.sh — klinik lokal sunucusunda ilk yönetici hesabı kurar.
#
# Kullanım:
#   ./scripts/admin-bootstrap.sh                       # interaktif
#   ./scripts/admin-bootstrap.sh --non-interactive     # ADMIN_BOOTSTRAP_* env'lerinden oku
#
# Root .env'i yükler (DATABASE_URL gerekli), sonra tsx ile TS script'i çalıştırır.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "✗ DATABASE_URL bulunamadı (.env içinde tanımlı olmalı)" >&2
  exit 1
fi

exec npx tsx apps/api/scripts/admin-bootstrap.ts "$@"
