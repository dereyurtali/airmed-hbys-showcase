#!/usr/bin/env bash
# cleanup-worktree.sh — PR merge sonrası worktree + branch temizliği.
#
# Kullanım:
#   ./scripts/cleanup-worktree.sh feat/foo-bar           # worktree sil + branch sil (merged ise)
#   ./scripts/cleanup-worktree.sh feat/foo-bar --force   # branch merge edilmemiş olsa bile sil
#
# Güvenlik: branch main'e merge edilmemişse default'ta SİLMEZ; --force gerekir.
# Worktree içinde uncommitted change varsa git worktree remove zaten reddeder.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREE_BASE="${WORKTREE_BASE:-$HOME/DNA-Projects/airmed-worktrees}"

BRANCH=""
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
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
  echo "kullanım: $0 <branch-adi> [--force]" >&2
  exit 1
fi

SLUG="${BRANCH//\//-}"
WORKTREE_PATH="$WORKTREE_BASE/$SLUG"

cd "$ROOT"

if [[ -d "$WORKTREE_PATH" ]]; then
  echo "→ worktree kaldırılıyor: $WORKTREE_PATH"
  if [[ $FORCE -eq 1 ]]; then
    git worktree remove --force "$WORKTREE_PATH"
  else
    git worktree remove "$WORKTREE_PATH"
  fi
else
  echo "  not: $WORKTREE_PATH yok, worktree adımı atlandı"
fi

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  MERGED=0
  if git branch --merged main 2>/dev/null | grep -qE "^[[:space:]]*$BRANCH\$"; then
    MERGED=1
  fi

  if [[ $MERGED -eq 1 || $FORCE -eq 1 ]]; then
    echo "→ local branch siliniyor: $BRANCH"
    if [[ $FORCE -eq 1 ]]; then
      git branch -D "$BRANCH"
    else
      git branch -d "$BRANCH"
    fi
  else
    echo "  uyarı: '$BRANCH' main'e merge edilmemiş, branch korundu (--force ile zorla sil)" >&2
  fi
else
  echo "  not: local branch '$BRANCH' zaten yok"
fi

echo "→ git fetch --prune (silinmiş remote ref'leri temizle)"
git fetch --prune --quiet

echo
echo "✓ Temizlik bitti"
