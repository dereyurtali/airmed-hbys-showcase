#!/usr/bin/env bash
# new-worktree.sh — Paralel Claude session için izole bir git worktree aç.
#
# Kullanım:
#   ./scripts/new-worktree.sh feat/foo-bar              # worktree + .env/.mcp.json + npm install
#   ./scripts/new-worktree.sh feat/foo-bar --no-install # npm install atla (hızlı)
#   ./scripts/new-worktree.sh feat/foo-bar --base=develop  # base branch override (default: main)
#
# Sonuç: ~/DNA-Projects/airmed-worktrees/<branch-slug>/ klasörü hazır,
# .env + .mcp.json kopyalanmış, (opsiyonel) bağımlılıklar kurulmuş.
# Yeni Claude session'ı O KLASÖRDE açılır → branch karışması fiziksel olarak imkansız.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREE_BASE="${WORKTREE_BASE:-$HOME/DNA-Projects/airmed-worktrees}"

BRANCH=""
BASE="main"
RUN_INSTALL=1

for arg in "$@"; do
  case "$arg" in
    --no-install) RUN_INSTALL=0 ;;
    --base=*)     BASE="${arg#*=}" ;;
    --base)       echo "--base için '=değer' kullan: --base=develop" >&2; exit 1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*) echo "bilinmeyen flag: $arg" >&2; exit 1 ;;
    *)
      if [[ -n "$BRANCH" ]]; then
        echo "tek bir branch ismi ver" >&2; exit 1
      fi
      BRANCH="$arg" ;;
  esac
done

if [[ -z "$BRANCH" ]]; then
  echo "kullanım: $0 <branch-adi> [--no-install] [--base=<branch>]" >&2
  exit 1
fi

# Branch prefix uyarısı (CLAUDE.md konvansiyonu — engellemez, sadece uyarır)
case "$BRANCH" in
  feat/*|fix/*|chore/*|docs/*|refactor/*) ;;
  *) echo "uyarı: '$BRANCH' önek konvansiyonuna (feat/fix/chore/docs/refactor) uymuyor" >&2 ;;
esac

SLUG="${BRANCH//\//-}"
WORKTREE_PATH="$WORKTREE_BASE/$SLUG"

if [[ -e "$WORKTREE_PATH" ]]; then
  echo "hata: $WORKTREE_PATH zaten var. Önce 'scripts/cleanup-worktree.sh $BRANCH' çalıştır." >&2
  exit 1
fi

mkdir -p "$WORKTREE_BASE"

cd "$ROOT"
echo "→ git fetch origin"
git fetch origin --quiet

echo "→ worktree oluşturuluyor: $WORKTREE_PATH ← $BASE"
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  # Branch local'de var → yeni branch oluşturma, mevcut olanı bağla
  git worktree add "$WORKTREE_PATH" "$BRANCH"
else
  git worktree add "$WORKTREE_PATH" -b "$BRANCH" "origin/$BASE"
fi

echo "→ .env kopyalanıyor"
if [[ -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env" "$WORKTREE_PATH/.env"
else
  echo "  uyarı: $ROOT/.env yok, atlandı" >&2
fi

echo "→ .mcp.json kopyalanıyor"
if [[ -f "$ROOT/.mcp.json" ]]; then
  cp "$ROOT/.mcp.json" "$WORKTREE_PATH/.mcp.json"
else
  echo "  uyarı: $ROOT/.mcp.json yok, atlandı (.mcp.json.example'dan üret)" >&2
fi

if [[ $RUN_INSTALL -eq 1 ]]; then
  echo "→ npm install (birkaç dakika sürebilir, atlamak için --no-install kullan)"
  (cd "$WORKTREE_PATH" && npm install)
else
  echo "→ npm install atlandı (--no-install)"
fi

cat <<EOF

✓ Worktree hazır: $WORKTREE_PATH

Sonraki adım:
  cd $WORKTREE_PATH
  claude          # yeni Claude session bu klasörde, sadece '$BRANCH' branch'inde

İş bittikten + PR merge'den sonra:
  scripts/cleanup-worktree.sh $BRANCH
EOF
