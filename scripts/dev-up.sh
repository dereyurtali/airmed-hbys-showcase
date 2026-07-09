#!/usr/bin/env bash
# dev-up.sh — feature/değişiklik sonrası tek komutla uygulamayı ayağa kaldır.
#
# Kullanım:
#   ./scripts/dev-up.sh          # docker + migrate + realistic seed (dev başlatma)
#   ./scripts/dev-up.sh --dev    # yukarıdakiler + npm run dev (foreground)
#   ./scripts/dev-up.sh --reset  # DB'yi sıfırdan kur (DİKKAT: tüm veri silinir)
#
# Idempotent: realistic seed deterministik UUID + upsert kullanır, tekrar
# çalıştırınca aynı 30 hasta / 4 doktor / 131 randevu / 11 ameliyat üretir.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Load root .env so prisma + tsx subshells see DATABASE_URL even when chdir'd into packages/db
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

RESET=0
RUN_DEV=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --dev)   RUN_DEV=1 ;;
    *) echo "bilinmeyen arg: $arg" >&2; exit 1 ;;
  esac
done

echo "▸ docker compose: postgres + redis"
docker compose up -d postgres redis >/dev/null

echo "▸ postgres healthy bekleniyor"
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U airmed -d airmed_hbys >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if [[ $RESET -eq 1 ]]; then
  echo "▸ DB reset (prisma migrate reset --force --skip-seed)"
  (cd packages/db && npx prisma migrate reset --force --skip-seed)
fi

echo "▸ prisma generate"
npm run --silent db:generate

echo "▸ prisma migrate deploy"
(cd packages/db && npx prisma migrate deploy)

echo "▸ baz seed (tenant + roller + sistem user'ları)"
npm run --silent db:seed

echo "▸ demo seed (login edilebilir rol başına user, doktor.demo dahil)"
npm run --silent --workspace=@airmed/db db:seed:demo

echo "▸ realistic seed (30 hasta / 4 doktor / 131 randevu / 11 ameliyat)"
npm run --silent db:seed:realistic

echo "▸ S15 seed (3 IOL model + 6 lot + 3 kit + 6 lab threshold)"
npm run --silent --workspace=@airmed/db db:seed:s15

# #714 — eczane seed: 10-rol dev ortamının eczane (POS/stok/PO) verisi. Yalnız
# dev (deterministik UUID, idempotent); staging/prod ASLA seed çalıştırmaz.
echo "▸ eczane seed (ürün + parti + PO örnek verisi)"
npm run --silent --workspace=@airmed/db db:seed:pharmacy

echo "✓ hazır. api: http://localhost:3001  web: http://localhost:5173  admin: http://localhost:5174"

if [[ $RUN_DEV -eq 1 ]]; then
  echo "▸ npm run dev (Ctrl-C ile durdur)"
  exec npm run dev
fi
