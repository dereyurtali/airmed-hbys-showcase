#!/usr/bin/env bash
# platform-admin-bootstrap.sh — ilk DNA Platform Admin hesabını kurar (#847).
#
# Kullanım:
#   ./scripts/platform-admin-bootstrap.sh                    # interaktif
#   ./scripts/platform-admin-bootstrap.sh --non-interactive  # PLATFORM_ADMIN_BOOTSTRAP_* env'lerinden oku
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

exec npx tsx apps/api/scripts/platform-admin-bootstrap.ts "$@"
